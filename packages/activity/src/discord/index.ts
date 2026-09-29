import type { FeatureModuleContext } from "@management-bot/core";
import type { Client, Guild, VoiceState } from "discord.js";
import { addHourlyActivity, type HourlyDelta } from "../application/index.js";
import { isCounting } from "../domain/index.js";
import { registerActivityCommand } from "./activity-command.js";
import { InFlightWrites } from "./in-flight.js";
import { MessageCounter } from "./message-counter.js";
import { VoiceTracker } from "./voice-tracker.js";

const FLUSH_INTERVAL_MS = 60_000;

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

  ctx.client.on("voiceStateUpdate", (_oldState, newState) => {
    if (newState.member?.user.bot) return;
    void voice
      .update(newState.guild.id, newState.id, countingOf(newState, newState.guild), new Date())
      .catch(logError("failed to record voice activity"));
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
  };
  if (ctx.client.isReady()) startTrackingPresent(ctx.client);
  else ctx.client.once("ready", startTrackingPresent);

  // 発言数のflushと併せて、在室中のVC区間も途中経過を書き込む(退室まで反映されないのを防ぐ)。
  const timer = setInterval(() => {
    void messages.flush().catch(logError("failed to flush message counts"));
    void voice.checkpoint(new Date()).catch(logError("failed to checkpoint voice activity"));
  }, FLUSH_INTERVAL_MS);

  registerActivityCommand(ctx);

  ctx.onShutdown(async () => {
    clearInterval(timer);
    const now = new Date();
    const results = await Promise.allSettled([voice.closeAll(now), messages.flush()]);
    for (const result of results) {
      if (result.status === "rejected") logError("failed to write activity on shutdown")(result.reason);
    }
    // イベントハンドラやタイマーから開始済みの書き込みも、DBが閉じられる前に完了を待つ。
    await inFlight.drain();
  });
}
