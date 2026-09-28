import type { FeatureModuleContext } from "@management-bot/core";
import { tempVoiceChannels, tempVoiceConfigs, type Db } from "@management-bot/db";
import type { VoiceState } from "discord.js";
import { shouldSuppressTempVoiceMoveLog, VOICE_STATE_FLAG_NAMES } from "@management-bot/shared";
import { and, eq, inArray } from "drizzle-orm";
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
    return { ...base, category: "voice", channelId: newChannelId, channelName: newState.channel?.name, action: "join" };
  }
  if (oldChannelId !== null && newChannelId === null) {
    return { ...base, category: "voice", channelId: oldChannelId, channelName: oldState.channel?.name, action: "leave" };
  }
  if (oldChannelId !== null && newChannelId !== null && oldChannelId !== newChannelId) {
    return {
      ...base,
      category: "voice",
      channelId: newChannelId,
      channelName: newState.channel?.name,
      previousChannelId: oldChannelId,
      previousChannelName: oldState.channel?.name,
      action: "move",
    };
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
    channelName: newState.channel?.name,
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

type VoiceLogEntry = Extract<LogEntry, { category: "voice" }>;

/**
 * チャンネル名スナップショットは一時VCのみ残す。一時VCは無人化で削除され<#id>が「不明」表示になるが、
 * 通常VCは<#id>のままの方が改名後も最新名で表示されるため。
 */
async function keepTempVoiceChannelNamesOnly(db: Db, entry: VoiceLogEntry): Promise<VoiceLogEntry> {
  const ids = entry.action === "move" ? [entry.channelId, entry.previousChannelId] : [entry.channelId];
  const rows = await db
    .select({ channelId: tempVoiceChannels.channelId })
    .from(tempVoiceChannels)
    .where(inArray(tempVoiceChannels.channelId, ids))
    // 判定失敗でログ自体を落とさない。名前なし(<#id>表示)で書き込む。
    .catch((error: unknown) => {
      console.error("logging: failed to look up temp voice channels", error);
      return [];
    });
  const tempIds = new Set(rows.map((row) => row.channelId));
  const channelName = tempIds.has(entry.channelId) ? entry.channelName : undefined;
  if (entry.action === "move") {
    const previousChannelName = tempIds.has(entry.previousChannelId) ? entry.previousChannelName : undefined;
    return { ...entry, channelName, previousChannelName };
  }
  return { ...entry, channelName };
}

export function registerVoiceHandlers(ctx: FeatureModuleContext, getChannelId: GetChannelId): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx), getChannelId };

  ctx.client.on("voiceStateUpdate", (oldState, newState) => {
    void (async () => {
      const moveEntry = toVoiceStateLogEntry(oldState, newState);
      if (moveEntry?.category === "voice") {
        // 作成チャンネルへの入室(別VCからの移動を含む)は直後に個人VCへ移されるため記録しない。
        const isCreateChannelJoin =
          (moveEntry.action === "join" || moveEntry.action === "move") &&
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
        if (!isCreateChannelJoin && !isRegisteredTempVoiceMove) {
          writeLogEntrySafely(deps, await keepTempVoiceChannelNamesOnly(ctx.db, moveEntry));
        }
      }
      const updateEntry = toVoiceStateUpdateEntry(oldState, newState);
      if (updateEntry?.category === "voice") writeLogEntrySafely(deps, await keepTempVoiceChannelNamesOnly(ctx.db, updateEntry));
    })().catch((error: unknown) => {
      console.error("logging: failed to handle voiceStateUpdate", error);
    });
  });
}
