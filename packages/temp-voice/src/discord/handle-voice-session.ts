import type { DomainEventBus } from "@management-bot/core";
import type { VoiceState } from "discord.js";
import type { VoiceSessionStore } from "./voice-session-store.js";

export interface HandleVoiceSessionDeps {
  eventBus: DomainEventBus;
  sessionStore: VoiceSessionStore;
}

// ユーザーごとにhandleVoiceSessionの処理を直列化する(codexレビュー指摘)。voiceStateUpdateは
// リスナー内でawaitせず発火されるため、同一ユーザーが短時間にc1→c2→c3と連続移動すると
// 並行実行され、recordLeaveのpublish待ち中に後続の呼び出しが先に完了してしまう
// (処理順の逆転によりセッションの開始・終了が入れ替わる)。userId単位のPromiseチェーンで直列化する。
// ponytail: プロセス内メモリのみでbot再起動を跨がない(#412のリコンサイル処理で別途扱う想定)。
const queueByUserId = new Map<string, Promise<void>>();

function runSerialized(userId: string, task: () => Promise<void>): Promise<void> {
  const previous = queueByUserId.get(userId) ?? Promise.resolve();
  const next = previous.then(task, task);
  const settled = next.catch(() => {});
  queueByUserId.set(userId, settled);
  // 自分がキューの最後尾のままなら(=このユーザーに後続の呼び出しが来ていなければ)、
  // 完了時にエントリを削除する。voiceStateUpdateが起きる全ユーザー分がプロセス終了まで
  // Mapに残り続けるのを防ぐ(codexレビュー指摘)。
  settled.then(() => {
    if (queueByUserId.get(userId) === settled) queueByUserId.delete(userId);
  });
  return next;
}

/**
 * voiceStateUpdateのうち、追跡対象(一時VC)チャンネルへの入退室・移動を検知してセッションを更新する(#414)。
 * join to createによるVC作成時のオーナー入室はvoice-create.ts側でstartTrackingChannel+recordJoinを直接呼ぶため
 * (作成用VCへのjoinがそのまま一時VCへのjoinになるわけではない特殊な遷移のため)、ここでは扱わない。
 */
export async function handleVoiceSession(deps: HandleVoiceSessionDeps, oldState: VoiceState, newState: VoiceState): Promise<void> {
  const oldChannelId = oldState.channelId;
  const newChannelId = newState.channelId;
  const userId = newState.id;
  const guildId = newState.guild.id;

  if (oldChannelId === newChannelId) return;

  await runSerialized(userId, async () => {
    const now = new Date();
    // recordLeave(publish)の失敗でrecordJoinまで止まると新VCへの入室記録自体が欠落する
    // (moveの片側だけが失敗した状態になる)ため、leave失敗はログのみ残しjoin記録は必ず行う(codexレビュー指摘)。
    if (oldChannelId && deps.sessionStore.isTracked(oldChannelId)) {
      await deps.sessionStore.recordLeave(deps.eventBus, guildId, oldChannelId, userId, now).catch((error: unknown) => {
        console.error(`temp-voice: failed to record session leave for channel ${oldChannelId}`, error);
      });
    }
    if (newChannelId && deps.sessionStore.isTracked(newChannelId)) {
      deps.sessionStore.recordJoin(newChannelId, userId, now);
    }
  });
}
