import type { FeatureModuleContext } from "@management-bot/core";
import type { VoiceState } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import type { WriteLogEntryDeps } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";
import { writeLogEntrySafely } from "../write-log-entry-safely.js";

/**
 * チャンネル異動を伴わない変更(ミュート/スピーカーオフ/映像ON等)はvoiceStateUpdateでも
 * 発火するが、ログ対象外(undefined)として除外する。
 */
export function toVoiceStateLogEntry(oldState: VoiceState, newState: VoiceState): LogEntry | undefined {
  const oldChannelId = oldState.channelId;
  const newChannelId = newState.channelId;
  const base = { guildId: newState.guild.id, createdAt: new Date().toISOString(), userId: newState.id } as const;

  if (oldChannelId === null && newChannelId !== null) {
    return { ...base, category: "voice", channelId: newChannelId, action: "join" };
  }
  if (oldChannelId !== null && newChannelId === null) {
    return { ...base, category: "voice", channelId: oldChannelId, action: "leave" };
  }
  if (oldChannelId !== null && newChannelId !== null && oldChannelId !== newChannelId) {
    return { ...base, category: "voice", channelId: newChannelId, previousChannelId: oldChannelId, action: "move" };
  }
  return undefined;
}

export function registerVoiceHandlers(ctx: FeatureModuleContext): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx) };

  ctx.client.on("voiceStateUpdate", (oldState, newState) => {
    const entry = toVoiceStateLogEntry(oldState, newState);
    if (entry) {
      writeLogEntrySafely(deps, entry);
    }
  });
}
