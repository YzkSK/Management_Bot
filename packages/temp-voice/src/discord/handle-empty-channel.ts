import type { DomainEventBus } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import { TEMP_VOICE_DELETE_REASON, suppressTempVoiceChannelLog } from "@management-bot/shared";
import type { VoiceState } from "discord.js";
import { deleteTempVoiceChannel, findTempVoiceChannel } from "../application/index.js";
import type { VoiceSessionStore } from "./voice-session-store.js";

export interface HandleEmptyChannelDeps {
  db: Db;
  eventBus: DomainEventBus;
  sessionStore: VoiceSessionStore;
  /** 無人になってから削除確定までの猶予(ms)。既定30秒(#411)。 */
  graceMs?: number;
}

const DEFAULT_GRACE_MS = 30_000;

/**
 * 無人になった一時VCの削除待ちタイマーを管理する(#411)。
 * ponytail: プロセス内メモリのみでbot再起動を跨がない(issue本文の通り、DB永続化しない設計)。
 * 再起動を跨いで削除待ちが失われるケースは#412のリコンサイル処理でカバーする。
 * VoiceSessionStore(#414)と同様、プロセス起動時に1回だけ生成しdiscord/index.tsで共有する。
 *
 * 世代カウンタ(codexレビュー指摘): cancel()はsetTimeout発火前しか止められないため、
 * 「タイマー発火→finalizeDeletion実行中(DB問い合わせ等のawait中)」に再入室した場合、
 * cancel()を呼んでも進行中の削除処理は止まらずTOCTOUで在室者ごと削除してしまう。
 * isCurrent(channelId, generation)を発火後・削除直前にも再チェックさせることで、
 * schedule/cancelが呼ばれるたびにgenerationを進め、古い世代の実行中処理を無効化する。
 */
export class EmptyChannelDeletionScheduler {
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly generations = new Map<string, number>();

  private bumpGeneration(channelId: string): number {
    const next = (this.generations.get(channelId) ?? 0) + 1;
    this.generations.set(channelId, next);
    return next;
  }

  /** VC削除時(この#411の自動削除以外の経路も含む)に呼ぶ。保留中のタイマーがあれば解除する。 */
  cancel(channelId: string): void {
    const timer = this.pending.get(channelId);
    if (timer) clearTimeout(timer);
    this.pending.delete(channelId);
    this.bumpGeneration(channelId);
  }

  /** shutdown時に全タイマーを解除する(codexレビュー指摘: cronのみ停止しても本タイマーは残り、最大graceMs分プロセスがぶら下がる)。 */
  cancelAll(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  /** 猶予タイマーを(再)セットする。既存のタイマーがあれば置き換える。発行したgenerationを返す(テスト用)。 */
  schedule(channelId: string, run: (generation: number) => void, graceMs: number): number {
    const timer = this.pending.get(channelId);
    if (timer) clearTimeout(timer);
    const generation = this.bumpGeneration(channelId);
    this.pending.set(
      channelId,
      setTimeout(() => {
        this.pending.delete(channelId);
        run(generation);
      }, graceMs),
    );
    return generation;
  }

  /** 呼び出し時点でもこのgenerationが最新(schedule/cancelで上書きされていない)かどうか。 */
  isCurrent(channelId: string, generation: number): boolean {
    return this.generations.get(channelId) === generation;
  }
}

/**
 * 猶予満了時に人数を再確認し、まだ無人ならVC・制御チャンネルを削除する(#411)。
 * channelがcache/fetchどちらでも見つからない(既に削除済み等)場合は何もしない。
 * generation(codexレビュー指摘)をawaitの前後で再チェックし、findTempVoiceChannel等の
 * 問い合わせ中に再入室(cancel)が発生していれば削除しない。
 * DB削除はDiscord側の削除(VC本体)が成功した後に行う(codexレビュー指摘: 先にDB行を消すと、
 * Discord API呼び出しが失敗してVCが残った場合に追跡不能な孤児チャンネルになり、
 * DB行が無いため以後の自動削除・強制削除の対象にもできなくなる)。
 */
export async function finalizeDeletion(
  deps: HandleEmptyChannelDeps,
  scheduler: EmptyChannelDeletionScheduler,
  guild: VoiceState["guild"],
  channelId: string,
  generation: number,
): Promise<void> {
  const fresh = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!fresh?.isVoiceBased() || fresh.members.size > 0) return;
  if (!scheduler.isCurrent(channelId, generation)) return;

  const row = await findTempVoiceChannel(deps.db, channelId);
  if (!row) return;
  if (!scheduler.isCurrent(channelId, generation)) return;
  // 再確認直前にDiscord側の状態が変わっている可能性がある(codexレビュー指摘の派生ケース)ため、
  // 実際にDiscord APIへ削除を投げる直前の人数も見る。cache参照のためfetchはしない(揺らぎの許容範囲)。
  const latest = guild.channels.cache.get(channelId);
  if (latest?.isVoiceBased() ? latest.members.size > 0 : fresh.members.size > 0) return;

  suppressTempVoiceChannelLog(fresh.id);
  suppressTempVoiceChannelLog(row.controlChannelId);
  const controlChannel = guild.channels.cache.get(row.controlChannelId) ?? (await guild.channels.fetch(row.controlChannelId).catch(() => null));

  try {
    await fresh.delete(TEMP_VOICE_DELETE_REASON);
  } catch (error) {
    console.error(`temp-voice: failed to delete empty channel ${fresh.id}`, error);
    return;
  }
  await controlChannel?.delete(TEMP_VOICE_DELETE_REASON).catch((error: unknown) => {
    // 制御チャンネル側の削除失敗は握りつぶす(VC本体は既に削除済みでDB行も消すため、孤立した
    // 制御チャンネルが残るだけで実害は小さい。孤児チャンネルはvoice-create.tsの
    // deleteChannelForRollbackと同じ扱い)。
    console.error(`temp-voice: failed to delete control channel ${row.controlChannelId}`, error);
  });

  await deleteTempVoiceChannel(deps.db, fresh.id);

  await deps.eventBus.publish({
    type: "temp-voice.event.recorded",
    action: "deleted",
    guildId: row.guildId,
    channelId: fresh.id,
    ownerId: row.ownerId,
    createdAt: new Date().toISOString(),
  });
}

/**
 * voiceStateUpdateのうち一時VCの入退室を検知し、無人化した際の削除猶予タイマーをセット/解除する(#411)。
 * sessionStore.isTracked(#414で導入済み)で追跡対象(一時VC)のみに絞る点はhandle-voice-session.tsと同様。
 * 退出元が無人になれば猶予タイマーを開始し、入室先へ再入室があればタイマーをキャンセルする。
 */
export function handleEmptyChannel(
  deps: HandleEmptyChannelDeps,
  scheduler: EmptyChannelDeletionScheduler,
  oldState: VoiceState,
  newState: VoiceState,
): void {
  const oldChannel = oldState.channel;
  const newChannel = newState.channel;
  if (oldChannel?.id === newChannel?.id) return;

  if (newChannel && deps.sessionStore.isTracked(newChannel.id)) scheduler.cancel(newChannel.id);

  if (oldChannel && deps.sessionStore.isTracked(oldChannel.id) && oldChannel.members.size === 0) {
    scheduler.schedule(
      oldChannel.id,
      (generation) => {
        finalizeDeletion(deps, scheduler, oldState.guild, oldChannel.id, generation).catch((error: unknown) => {
          console.error(`temp-voice: failed to finalize deletion for channel ${oldChannel.id}`, error);
        });
      },
      deps.graceMs ?? DEFAULT_GRACE_MS,
    );
  }
}
