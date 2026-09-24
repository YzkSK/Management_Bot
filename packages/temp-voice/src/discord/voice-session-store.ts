import type { DomainEventBus } from "@management-bot/core";
import { buildVoiceSessionEndedEvent } from "../domain/index.js";

/**
 * 一時VC内メンバーの入退室セッションをプロセス内メモリで管理する(#414)。
 * bot再起動を跨ぐ厳密性は求めない(再起動時のフォールバックは#412のリコンサイル処理で扱う)。
 * channelIdをキーに持つエントリの存在自体が「このチャンネルは現在追跡中の一時VCである」ことを表す
 * (一時VC作成時にstartTrackingChannelで登録、削除時にstopTrackingChannelで除去する)。
 */
export class VoiceSessionStore {
  private readonly sessionsByChannel = new Map<string, Map<string, Date>>();
  // recordLeaveとendAllSessionsForChannelは同一チャンネルに対して同時に呼ばれると、
  // 片方がpublish待ちの間にもう片方がスナップショットを取ってしまい、同じユーザー分を
  // 二重にpublishする(codexレビュー指摘)。チャンネルIDごとにPromiseチェーンで直列化する。
  private readonly queueByChannel = new Map<string, Promise<void>>();

  private runSerialized(channelId: string, task: () => Promise<void>): Promise<void> {
    const previous = this.queueByChannel.get(channelId) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.catch(() => {});
    this.queueByChannel.set(channelId, settled);
    settled.then(() => {
      if (this.queueByChannel.get(channelId) === settled) this.queueByChannel.delete(channelId);
    });
    return next;
  }

  /** VC作成時に呼ぶ。追跡対象チャンネルとして登録する(既に登録済みなら何もしない)。 */
  startTrackingChannel(channelId: string): void {
    if (!this.sessionsByChannel.has(channelId)) this.sessionsByChannel.set(channelId, new Map());
  }

  /** このチャンネルが現在追跡対象(一時VC)かどうか。 */
  isTracked(channelId: string): boolean {
    return this.sessionsByChannel.has(channelId);
  }

  /** メンバーの入室を記録する。追跡対象外のチャンネルなら何もしない。 */
  recordJoin(channelId: string, userId: string, at: Date): void {
    this.sessionsByChannel.get(channelId)?.set(userId, at);
  }

  /**
   * メンバーの退室を記録し、開始時刻が分かればvoice.session.endedをpublishしてメモリから除去する。
   * 開始時刻が無い(bot起動前から入室していた等、またはendAllSessionsForChannelと競合し
   * 既に除去済み)場合はイベントを発行しない。
   * publish失敗時(Redis障害等)でも、ユーザーは実際には既にこのチャンネルを退室しているため
   * メモリからは削除する(codexレビュー指摘: 削除しないままにすると、以後この呼び出し元
   * (handleVoiceSession)は失敗を握りつぶして別チャンネルへのjoinを記録するため、同一ユーザーが
   * 2チャンネルに同時在籍する状態になり、後続の集計・削除時に水増しされたイベントを生む)。
   * publish失敗はイベント配信の欠落(ログで検知)として許容し、リトライは行わない。
   */
  async recordLeave(
    eventBus: DomainEventBus,
    guildId: string,
    channelId: string,
    userId: string,
    at: Date,
  ): Promise<void> {
    await this.runSerialized(channelId, async () => {
      const sessions = this.sessionsByChannel.get(channelId);
      const startedAt = sessions?.get(userId);
      if (!startedAt) return;
      sessions?.delete(userId);
      await eventBus.publish(buildVoiceSessionEndedEvent({ guildId, userId, channelId, startedAt, endedAt: at }));
    });
  }

  /**
   * VC削除時に呼ぶ。万一残存メンバーがいた場合も全員分を強制的にセッション終了させ、
   * 追跡対象から完全に除去する(issueの受け入れ条件)。VC自体が削除済みで再送機会が無いため、
   * publishが一部失敗してもチャンネルは追跡対象から必ず除去する(codexレビュー指摘: 失敗分を
   * メモリに残す設計だと、削除済みチャンネルがisTracked()にtrueを返し続けメモリリークになる)。
   * 失敗はログに残るのみで、イベント配信の欠落は許容する。
   */
  async endAllSessionsForChannel(eventBus: DomainEventBus, guildId: string, channelId: string, at: Date): Promise<void> {
    await this.runSerialized(channelId, async () => {
      const sessions = this.sessionsByChannel.get(channelId);
      if (!sessions) return;
      const entries = [...sessions.entries()];
      this.sessionsByChannel.delete(channelId);
      const results = await Promise.allSettled(
        entries.map(([userId, startedAt]) =>
          eventBus.publish(buildVoiceSessionEndedEvent({ guildId, userId, channelId, startedAt, endedAt: at })),
        ),
      );
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          console.error(`temp-voice: failed to publish voice.session.ended for channel ${channelId} user ${entries[index]?.[0]}`, result.reason);
        }
      });
    });
  }

  /**
   * race condition(#407)によるロールバック等、VCが実質存在しなかった扱いになるケース用。
   * イベント発行を伴わず追跡対象から除去するだけの軽量版(endAllSessionsForChannelと異なり
   * voice.session.endedをpublishしない)。
   */
  discardChannel(channelId: string): void {
    this.sessionsByChannel.delete(channelId);
  }

  /**
   * #410(自動再割当)向け: 現在VC内で最も長く滞在している(startedAtが最も古い)ユーザーIDを返す。
   * 誰もいなければnull。
   */
  findLongestPresentUserId(channelId: string): string | null {
    const sessions = this.sessionsByChannel.get(channelId);
    if (!sessions || sessions.size === 0) return null;
    let oldestUserId: string | null = null;
    let oldestStartedAt: Date | null = null;
    for (const [userId, startedAt] of sessions) {
      if (!oldestStartedAt || startedAt < oldestStartedAt) {
        oldestUserId = userId;
        oldestStartedAt = startedAt;
      }
    }
    return oldestUserId;
  }
}
