import type { FeatureModuleContext } from "@management-bot/core";
import type { Client, Guild, VoiceState } from "discord.js";
import { Redis } from "ioredis";
import { addHourlyActivity, type HourlyDelta, publishActivityChanged, setActiveVoiceCountingSince } from "../application/index.js";
import { type ActivityChangeKind, isCounting } from "../domain/index.js";
import { registerActivityCommand } from "./activity-command.js";
import { activeVoiceQueueKey, extendAllActiveVoiceTtl, rebuildActiveVoice, syncActiveVoice } from "./active-voice-sync.js";
import { InFlightWrites } from "./in-flight.js";
import { KeyedQueue } from "./keyed-queue.js";
import { MessageCounter } from "./message-counter.js";
import { VoiceTracker } from "./voice-tracker.js";

// 画面は進行中の区間をcountingSinceから加算するため、この間隔は反映速度に関係しない(クラッシュ時の取りこぼし上限)。
const CHECKPOINT_INTERVAL_MS = 60_000;
// TTL(120秒)の半分で延長し、botが落ちたらアクティブVC表示が自然に消えるようにする。
const ACTIVE_VOICE_TTL_REFRESH_MS = 60_000;

function countingOf(state: VoiceState, guild: Guild): boolean {
  return isCounting(
    {
      channelId: state.channelId,
      selfMute: state.selfMute ?? false,
      selfDeaf: state.selfDeaf ?? false,
      serverMute: state.serverMute ?? false,
      serverDeaf: state.serverDeaf ?? false,
    },
    guild.afkChannelId,
  );
}

function logError(message: string): (error: unknown) => void {
  return (error) => console.error(`activity: ${message}`, error);
}

export function registerDiscordHandlers(ctx: FeatureModuleContext): void {
  const inFlight = new InFlightWrites();
  // lazyConnect: 最初のイベントまで接続を開かない(moderationと同じ)。
  const redis = new Redis(ctx.redisUrl, { lazyConnect: true });
  // 通知の失敗はログのみ(次の通知・画面の再接続時の取り直しで回復する)。
  const notify = (guildId: string, kind: ActivityChangeKind) =>
    void publishActivityChanged(redis, guildId, kind).catch(logError("failed to publish activity change"));
  const write = (deltas: HourlyDelta[]) =>
    inFlight.track(
      addHourlyActivity(ctx.db, deltas).then(() => {
        for (const guildId of new Set(deltas.map((d) => d.guildId))) notify(guildId, "stats");
      }),
    );
  const voice = new VoiceTracker(write);
  // 発言は即時にflushするが、書き込み失敗分はメモリに持ち越して次のflush(次の発言・定期処理)で再試行する。
  const messages = new MessageCounter(write);
  const flushMessages = () => void messages.flush().catch(logError("failed to flush message counts"));
  const countingSinceOf = (guildId: string, userId: string) => voice.countingSince(guildId, userId);
  const activeVoiceQueue = new KeyedQueue();
  // アクティブVCのRedis更新は必ず同一メンバーのキューを通す(退室者の書き戻し防止)。
  const syncVoice = (guildId: string, userId: string, task: () => Promise<unknown>) =>
    activeVoiceQueue
      .run(activeVoiceQueueKey(guildId, userId), task)
      .then(() => notify(guildId, "voice"))
      .catch(logError("failed to sync active voice"));

  ctx.client.on("voiceStateUpdate", (_oldState, newState) => {
    if (newState.member?.user.bot) return;
    const now = new Date();
    void voice
      .update(newState.guild.id, newState.id, countingOf(newState, newState.guild), now)
      .catch(logError("failed to record voice activity"));
    // voice.updateは区間の開始・終了を同期的に反映するため、キュー上のsyncは最新のcountingSinceを読む。
    void syncVoice(newState.guild.id, newState.id, () => syncActiveVoice(redis, newState, now, countingSinceOf));
  });

  ctx.client.on("messageCreate", (message) => {
    if (message.author.bot || !message.inGuild()) return;
    messages.record(message.guildId, message.author.id, message.createdAt);
    flushMessages();
  });

  // 起動時点で在室中のメンバーは起動時刻から計上する(それ以前の滞在は分からないため)。
  const startTrackingPresent = (client: Client) => {
    const now = new Date();
    for (const guild of client.guilds.cache.values()) {
      for (const state of guild.voiceStates.cache.values()) {
        if (state.member?.user.bot) continue;
        void voice.update(guild.id, state.id, countingOf(state, guild), now).catch(logError("failed to start voice tracking"));
      }
    }
    void rebuildActiveVoice(redis, client.guilds.cache.values(), activeVoiceQueue, now, countingSinceOf)
      .then(() => {
        for (const guildId of client.guilds.cache.keys()) notify(guildId, "voice");
      })
      .catch(logError("failed to rebuild active voice"));
  };
  if (ctx.client.isReady()) startTrackingPresent(ctx.client);
  else ctx.client.once("ready", startTrackingPresent);

  // 在室中のVC区間の途中経過を書き込み、書けた分だけアクティブVCのcountingSinceを進める(画面側で二重計上しない)。
  // ponytail: 書き込み失敗時はcountingSinceが古いまま残り、画面は次のcheckpointまで最大60秒多く見える。
  const timer = setInterval(() => {
    flushMessages();
    void voice
      .checkpoint(new Date())
      .then((advanced) => {
        for (const { guildId, userId } of advanced) {
          void syncVoice(guildId, userId, () =>
            setActiveVoiceCountingSince(redis, guildId, userId, voice.countingSince(guildId, userId)?.toISOString() ?? null),
          );
        }
      })
      .catch(logError("failed to checkpoint voice activity"));
  }, CHECKPOINT_INTERVAL_MS);

  const ttlTimer = setInterval(() => {
    void extendAllActiveVoiceTtl(redis, ctx.client).catch(logError("failed to extend active voice ttl"));
  }, ACTIVE_VOICE_TTL_REFRESH_MS);

  registerActivityCommand(ctx);

  ctx.onShutdown(async () => {
    clearInterval(timer);
    clearInterval(ttlTimer);
    const now = new Date();
    const results = await Promise.allSettled([voice.closeAll(now), messages.flush()]);
    for (const result of results) {
      if (result.status === "rejected") logError("failed to write activity on shutdown")(result.reason);
    }
    // イベントハンドラやタイマーから開始済みの書き込みも、DBが閉じられる前に完了を待つ。
    await inFlight.drain();
    redis.disconnect();
  });
}
