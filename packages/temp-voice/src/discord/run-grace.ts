import type { DomainEventBus } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import { sql } from "drizzle-orm";
import { completeExpiredGracePeriod, findExpiredGracePeriodChannels, type ExpiredGracePeriodChannelRow } from "../application/index.js";
import { editControlChannelViewer } from "./control-channel-permission.js";
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

/**
 * 猶予期限切れのVCを1件処理する(#410)。VC内に現在誰か残っていれば最も長く滞在している
 * メンバーへオーナーを再割当し、誰もいなければ何もしない(次回のcron実行に持ち越す)。
 * 最有力候補が既に別の一時VCのオーナーでunique制約違反になった場合、その候補を除外して
 * 次点の候補で再試行する(codexレビュー指摘: newOwnerAlreadyOwnsChannelを無視すると
 * 誰も再割当されないまま猶予期限切れ状態が残ってしまう)。
 *
 * DBトランザクションの外でDiscord API呼び出しを行う(codexレビュー指摘: advisory lock保持中に
 * ネットワークI/Oを挟むとロック保持時間が伸び、部分失敗時にDiscord側だけ変更されDBがロール
 * バックされる不整合が起きる)。整合性はDB更新をcompleteExpiredGracePeriod(compare-and-swap、
 * WHERE gracePeriodOwnerId=期待値かつgracePeriodEndsAt=期待値)で守ることで確保する。
 * gracePeriodEndsAtも条件に含めるのは、オーナーが猶予中に再入室→即再退出して新しい猶予が
 * 始まった場合、gracePeriodOwnerId(同一ユーザー)だけでは新しい猶予を誤って確定してしまう
 * ため(codexレビュー指摘)。手動移譲(handle-transfer-owner.ts)と競合した場合、後から実行
 * される側のCASが0行更新となり、そちらは制御チャンネル権限だけロールバックして何もしない
 * (codexレビュー指摘: 手動移譲とcronの二重移譲防止)。
 */
async function processExpiredChannel(deps: GraceRunnerDeps, row: ExpiredGracePeriodChannelRow): Promise<void> {
  const triedUserIds = new Set<string>();

  for (;;) {
    // cronの対象者選定時点とDiscord API呼び出し時点の間にleaveする可能性があるため、
    // 呼び出し直前にも生存確認する(codexレビュー指摘: 対象者の再検証不足)。
    const newOwnerId = deps.sessionStore.findLongestPresentUserId(row.channelId, triedUserIds);
    if (!newOwnerId) return;
    triedUserIds.add(newOwnerId);

    await editControlChannelViewer(deps.client, row.controlChannelId, newOwnerId, true);

    const result = await completeExpiredGracePeriod(deps.db, row.channelId, row.gracePeriodOwnerId, row.gracePeriodEndsAt, newOwnerId);
    if (result === "newOwnerAlreadyOwnsChannel") {
      // 候補者が既に別の一時VCのオーナーだった。付与した権限を戻し、次点の候補で再試行する。
      await editControlChannelViewer(deps.client, row.controlChannelId, newOwnerId, null).catch((error: unknown) => {
        console.error(`temp-voice: failed to roll back control channel permission for ${row.channelId} after unique violation`, error);
      });
      continue;
    }
    if (result === "lostRace") {
      // 手動移譲(または別プロセスのcron)が先にオーナーを変更済み。付与した閲覧権限を戻す。
      await editControlChannelViewer(deps.client, row.controlChannelId, newOwnerId, null).catch((error: unknown) => {
        console.error(`temp-voice: failed to roll back control channel permission for ${row.channelId} after CAS miss`, error);
      });
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
