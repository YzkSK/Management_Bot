import type { FeatureModuleContext } from "@management-bot/core";
import { tempVoiceConfigs, type Db } from "@management-bot/db";
import type { VoiceState } from "discord.js";
import { shouldSuppressTempVoiceMoveLog, VOICE_STATE_FLAG_NAMES } from "@management-bot/shared";
import { and, eq } from "drizzle-orm";
import type { LogEntry } from "../../domain/index.js";
import type { GetChannelId, WriteLogEntryDeps } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";
import { writeLogEntrySafely } from "../write-log-entry-safely.js";

/**
 * チャンネル移動(join/leave/move)を検知する。同一チャンネル内の変更は別途toVoiceStateUpdateEntryで扱う。
 */
export function toVoiceStateLogEntry(oldState: VoiceState, newState: VoiceState): LogEntry | undefined {
  const oldChannelId = oldState.channelId;
  const newChannelId = newState.channelId;
  const base = {
    guildId: newState.guild.id,
    createdAt: new Date().toISOString(),
    userId: newState.id,
    // leave(newState.member===null)ではスナップショットを残せない。
    userName: newState.member?.displayName,
  } as const;

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

/**
 * selfMute/selfDeaf/serverMute/serverDeaf/streamingの変化を検知する。
 * join(未接続→接続)・leave(接続→未接続)は接続前後の状態比較に意味がないため対象外。
 * move(チャンネル間の移動)は移動先channelIdで変化を記録する(移動と同時のミュート操作等を取りこぼさないため)。
 */
export function toVoiceStateUpdateEntry(oldState: VoiceState, newState: VoiceState): LogEntry | undefined {
  if (oldState.channelId === null || newState.channelId === null) {
    return undefined;
  }

  const changes: Record<string, { before: boolean; after: boolean }> = {};
  for (const flag of VOICE_STATE_FLAG_NAMES) {
    const before = Boolean(oldState[flag]);
    const after = Boolean(newState[flag]);
    if (before !== after) {
      changes[flag] = { before, after };
    }
  }
  if (Object.keys(changes).length === 0) {
    return undefined;
  }

  return {
    guildId: newState.guild.id,
    createdAt: new Date().toISOString(),
    userId: newState.id,
    userName: newState.member?.displayName,
    category: "voice",
    channelId: newState.channelId,
    action: "update",
    changes,
  };
}

async function isTempVoiceCreateChannel(db: Db, guildId: string, channelId: string): Promise<boolean> {
  const rows = await db
    .select({ createChannelId: tempVoiceConfigs.createChannelId })
    .from(tempVoiceConfigs)
    .where(and(eq(tempVoiceConfigs.guildId, guildId), eq(tempVoiceConfigs.createChannelId, channelId)));
  return rows.length > 0;
}

export function registerVoiceHandlers(ctx: FeatureModuleContext, getChannelId: GetChannelId): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx), getChannelId };

  ctx.client.on("voiceStateUpdate", (oldState, newState) => {
    void (async () => {
      const moveEntry = toVoiceStateLogEntry(oldState, newState);
      if (moveEntry?.category === "voice") {
        const isCreateChannelJoin =
          moveEntry.action === "join" &&
          newState.channelId !== null &&
          (await isTempVoiceCreateChannel(ctx.db, newState.guild.id, newState.channelId));
        const isRegisteredTempVoiceMove =
          moveEntry.action === "move" &&
          oldState.channelId !== null &&
          newState.channelId !== null &&
          shouldSuppressTempVoiceMoveLog({
            guildId: newState.guild.id,
            userId: newState.id,
            previousChannelId: oldState.channelId,
            channelId: newState.channelId,
          });
        if (!isCreateChannelJoin && !isRegisteredTempVoiceMove) writeLogEntrySafely(deps, moveEntry);
      }
      const updateEntry = toVoiceStateUpdateEntry(oldState, newState);
      if (updateEntry) writeLogEntrySafely(deps, updateEntry);
    })().catch((error: unknown) => {
      console.error("logging: failed to handle voiceStateUpdate", error);
    });
  });
}
