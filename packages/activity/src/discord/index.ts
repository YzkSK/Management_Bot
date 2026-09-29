import type { FeatureModuleContext } from "@management-bot/core";
import type { Client, Guild, VoiceState } from "discord.js";
import { Redis } from "ioredis";
import { addHourlyActivity, type HourlyDelta } from "../application/index.js";
import { isCounting } from "../domain/index.js";
import { registerActivityCommand } from "./activity-command.js";
import { extendAllActiveVoiceTtl, rebuildActiveVoice, syncActiveVoice } from "./active-voice-sync.js";
import { InFlightWrites } from "./in-flight.js";
import { MessageCounter } from "./message-counter.js";
import { VoiceTracker } from "./voice-tracker.js";

// Dashboardへの反映遅延を抑えるため短めにする(1回の書き込みは数行のUPSERTで軽い)。
const FLUSH_INTERVAL_MS = 10_000;
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
  const write = (deltas: HourlyDelta[]) => inFlight.track(addHourlyActivity(ctx.db, deltas));
  const voice = new VoiceTracker(write);
  const messages = new MessageCounter(write);
  // lazyConnect: 最初のVCイベントまで接続を開かない(moderationと同じ)。
  const redis = new Redis(ctx.redisUrl, { lazyConnect: true });

  ctx.client.on("voiceStateUpdate", (_oldState, newState) => {
    if (newState.member?.user.bot) return;
    const now = new Date();
    void voice
      .update(newState.guild.id, newState.id, countingOf(newState, newState.guild), now)
      .catch(logError("failed to record voice activity"));
    void syncActiveVoice(redis, newState, now).catch(logError("failed to sync active voice"));
  });

  ctx.client.on("messageCreate", (message) => {
    if (message.author.bot || !message.inGuild()) return;
    messages.record(message.guildId, message.author.id, message.createdAt);
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
    void rebuildActiveVoice(redis, client, now).catch(logError("failed to rebuild active voice"));
  };
  if (ctx.client.isReady()) startTrackingPresent(ctx.client);
  else ctx.client.once("ready", startTrackingPresent);

  // 発言数のflushと併せて、在室中のVC区間も途中経過を書き込む(退室まで反映されないのを防ぐ)。
  const timer = setInterval(() => {
    void messages.flush().catch(logError("failed to flush message counts"));
    void voice.checkpoint(new Date()).catch(logError("failed to checkpoint voice activity"));
  }, FLUSH_INTERVAL_MS);

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
