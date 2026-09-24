import type { DomainEventBus } from "@management-bot/core";
import { withResourceLock, type Db } from "@management-bot/db";
import { sql } from "drizzle-orm";
import { completeExpiredGracePeriod, findExpiredGracePeriodChannels, type ExpiredGracePeriodChannelRow } from "../application/index.js";
import { editControlChannelViewer, rollbackGrantedViewerIfNotOwner } from "./control-channel-permission.js";
import type { VoiceSessionStore } from "./voice-session-store.js";
import type { Client } from "discord.js";

// アプリ全体で1つに固定した任意の64bit定数。他機能のadvisory lockと衝突しないよう、
// このジョブ専用のキーとして予約する(moderation-decayの869_412_502、logging-retentionの
// 869_412_501とは別値)。
const ADVISORY_LOCK_KEY = 869_412_503;

export interface GraceRunnerDeps {
  db: Db;
  client: Client;
  eventBus: DomainEventBus;
  sessionStore: VoiceSessionStore;
}

export interface GraceRunner {
  run: () => Promise<void>;
  /** 実行中のジョブがあれば完了を待つ。graceful shutdown時にcron停止後呼ぶ。 */
  waitForIdle: () => Promise<void>;
}

/** チャンネル単位のオーナー移譲処理を排他するadvisory lockのキーprefix(#410、codexレビュー指摘)。 */
export const OWNER_TRANSFER_LOCK_KEY_PREFIX = "temp-voice:owner-transfer:";

/**
 * 猶予期限切れのVCを1件処理する(#410)。VC内に現在誰か残っていれば最も長く滞在している
 * メンバーへオーナーを再割当し、誰もいなければ何もしない(次回のcron実行に持ち越す)。
 * 最有力候補が既に別の一時VCのオーナーでunique制約違反になった場合、その候補を除外して
 * 次点の候補で再試行する(codexレビュー指摘: newOwnerAlreadyOwnsChannelを無視すると
 * 誰も再割当されないまま猶予期限切れ状態が残ってしまう)。
 *
 * withResourceLock(channelId単位のセッションスコープadvisory lock)で全体を包み、
 * 手動移譲(handle-transfer-owner.ts、同じロックキーを使う)との間で「DBの現在owner確認→
 * Discord API呼び出し→DB確定」の一連の処理をアトミックに見せる(codexレビュー指摘:
 * rollbackGrantedViewerIfNotOwnerだけではDB再読込とDiscord書き込みの間にTOCTOUが残っていた)。
 */
async function processExpiredChannel(deps: GraceRunnerDeps, row: ExpiredGracePeriodChannelRow): Promise<void> {
  await withResourceLock(deps.db, `${OWNER_TRANSFER_LOCK_KEY_PREFIX}${row.channelId}`, () => processExpiredChannelLocked(deps, row));
}

async function processExpiredChannelLocked(deps: GraceRunnerDeps, row: ExpiredGracePeriodChannelRow): Promise<void> {
  const triedUserIds = new Set<string>();

  for (;;) {
    // cronの対象者選定時点とDiscord API呼び出し時点の間にleaveする可能性があるため、
    // 呼び出し直前にも生存確認する(codexレビュー指摘: 対象者の再検証不足)。
    const newOwnerId = deps.sessionStore.findLongestPresentUserId(row.channelId, triedUserIds);
    if (!newOwnerId) return;
    triedUserIds.add(newOwnerId);

    await editControlChannelViewer(deps.client, row.controlChannelId, newOwnerId, true);

    let result: Awaited<ReturnType<typeof completeExpiredGracePeriod>>;
    try {
      result = await completeExpiredGracePeriod(deps.db, row.channelId, row.gracePeriodOwnerId, row.gracePeriodEndsAt, newOwnerId);
    } catch (error) {
      // unique制約違反以外のDBエラー(接続断等)。付与済みの権限をDBの現オーナーで確認しつつ
      // ロールバックする(codexレビュー指摘: 例外がそのまま伝播すると付与済み権限が孤立して残る)。
      await rollbackGrantedViewerIfNotOwner(deps.db, deps.client, row.channelId, row.controlChannelId, newOwnerId).catch(
        (rollbackError: unknown) => {
          console.error(`temp-voice: failed to roll back control channel permission for ${row.channelId} after DB error`, rollbackError);
        },
      );
      throw error;
    }
    if (result === "newOwnerAlreadyOwnsChannel") {
      // 候補者が既に別の一時VCのオーナーだった。DBの現オーナーを再確認してから権限を戻し、
      // 次点の候補で再試行する(codexレビュー指摘: 無条件に剥奪すると、勝者側が同じ候補者を
      // 新オーナーに選んでいた場合に正当な権限を奪ってしまう)。
      await rollbackGrantedViewerIfNotOwner(deps.db, deps.client, row.channelId, row.controlChannelId, newOwnerId).catch(
        (error: unknown) => {
          console.error(`temp-voice: failed to roll back control channel permission for ${row.channelId} after unique violation`, error);
        },
      );
      continue;
    }
    if (result === "lostRace") {
      // 手動移譲(または別プロセスのcron)が先にオーナーを変更済み。DBの現オーナーを再確認してから
      // 付与した閲覧権限を戻す(codexレビュー指摘: 同上)。
      await rollbackGrantedViewerIfNotOwner(deps.db, deps.client, row.channelId, row.controlChannelId, newOwnerId).catch(
        (error: unknown) => {
          console.error(`temp-voice: failed to roll back control channel permission for ${row.channelId} after CAS miss`, error);
        },
      );
      return;
    }

    await editControlChannelViewer(deps.client, row.controlChannelId, row.gracePeriodOwnerId, null).catch((error: unknown) => {
      // DB更新は既に確定しているため、旧オーナーの権限剥奪失敗は握りつぶしログのみ(孤立した閲覧権限が残るだけで実害は小さい)。
      console.error(`temp-voice: failed to revoke previous owner control channel permission for ${row.channelId}`, error);
    });

    const guild = deps.client.guilds.cache.get(row.guildId);
    await deps.eventBus.publish({
      type: "temp-voice.event.recorded",
      action: "ownerTransferred",
      guildId: row.guildId,
      channelId: row.channelId,
      createdAt: new Date().toISOString(),
      previousOwnerId: row.gracePeriodOwnerId,
      previousOwnerName: guild?.members.cache.get(row.gracePeriodOwnerId)?.displayName,
      newOwnerId,
      newOwnerName: guild?.members.cache.get(newOwnerId)?.displayName,
      trigger: "autoGraceExpired",
    });
    return;
  }
}

/**
 * apps/bot内でcron登録して使う、猶予期限切れVCの自動再割当ランナー(#410)。
 * 「VC内に最も長く滞在しているメンバー」の判定はbotプロセス内メモリのVoiceSessionStore(#414)に
 * 依存するため、独立プロセスのcronではなくbot本体プロセス内で動かす設計にしている
 * (Discord REST APIにはVC内メンバー一覧を返すエンドポイントが無く、別プロセスからは参照できない)。
 * advisory lockは対象一覧取得(短時間のDBトランザクション)のみを保護し、その後のDiscord API
 * 呼び出し・DB更新はロック外でcompare-and-swapにより安全に行う(codexレビュー指摘)。
 */
export function createGraceRunner(
  deps: GraceRunnerDeps,
  onResult: (message: string) => void = console.log,
  onError: (error: unknown) => void = (e) => console.error("Temp-voice grace job failed:", e),
): GraceRunner {
  let inFlight: Promise<void> | undefined;

  async function execute(): Promise<void> {
    try {
      const expired = await deps.db.transaction(async (tx) => {
        const [lock] = await tx.execute<{ acquired: boolean }>(
          sql`SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_KEY}) AS acquired`,
        );
        if (!lock?.acquired) {
          onResult("Skipping temp-voice grace job: another instance is already running it");
          return [];
        }
        return findExpiredGracePeriodChannels(tx, new Date());
      });
      for (const row of expired) {
        await processExpiredChannel(deps, row).catch((error: unknown) => {
          console.error(`temp-voice: failed to process expired grace period for channel ${row.channelId}`, error);
        });
      }
      if (expired.length > 0) onResult(`Temp-voice grace job completed (${expired.length} channel(s) processed)`);
    } catch (error) {
      onError(error);
    } finally {
      inFlight = undefined;
    }
  }

  return {
    async run() {
      if (inFlight) {
        onResult("Skipping temp-voice grace job: previous run is still active");
        return;
      }
      inFlight = execute();
      await inFlight;
    },
    async waitForIdle() {
      await inFlight;
    },
  };
}
