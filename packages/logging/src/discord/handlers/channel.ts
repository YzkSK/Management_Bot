import type { FeatureModuleContext } from "@management-bot/core";
import { shouldSuppressTempVoiceChannelLog } from "@management-bot/shared";
import type { DMChannel, NonThreadGuildBasedChannel } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import type { GetChannelId, WriteLogEntryDeps } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";
import { writeLogEntrySafely } from "../write-log-entry-safely.js";

function isGuildChannel(channel: DMChannel | NonThreadGuildBasedChannel): channel is NonThreadGuildBasedChannel {
  return "guild" in channel;
}

export function toChannelCreateLogEntry(channel: NonThreadGuildBasedChannel): LogEntry {
  return {
    category: "channel",
    guildId: channel.guild.id,
    createdAt: new Date().toISOString(),
    channelId: channel.id,
    action: "create",
  };
}

type TrackedChannelValue = string | number | boolean | null;

/**
 * 全チャンネル種別に共通する主要フィールドのみを追跡対象とする。
 * parentId(カテゴリ移動)・rtcRegion・videoQualityMode等のチャンネル種別依存フィールドは対象外。
 */
const TRACKED_CHANNEL_FIELDS = ["name", "topic", "nsfw", "rateLimitPerUser", "bitrate", "userLimit"] as const;

/** topicはチャンネル種別によってnull(未設定)を取り得るため、nullのまま区別して比較する。それ以外の型(数値・真偽値・文字列・null以外)は追跡対象外としてundefinedを返す。 */
function getTrackedChannelValue(channel: NonThreadGuildBasedChannel, field: (typeof TRACKED_CHANNEL_FIELDS)[number]): TrackedChannelValue | undefined {
  const value = (channel as unknown as Record<string, unknown>)[field];
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return undefined;
}

/** oldChannelとnewChannelを比較し、実際に変化したフィールドのみをchangesに含める。無関係なチャンネルへの波及等で差分がなければundefinedを返す。 */
export function toChannelUpdateLogEntry(
  oldChannel: DMChannel | NonThreadGuildBasedChannel,
  newChannel: DMChannel | NonThreadGuildBasedChannel,
): LogEntry | undefined {
  if (!isGuildChannel(newChannel) || !isGuildChannel(oldChannel)) return undefined;

  const changes: Record<string, { before: TrackedChannelValue; after: TrackedChannelValue }> = {};
  for (const field of TRACKED_CHANNEL_FIELDS) {
    const before = getTrackedChannelValue(oldChannel, field);
    const after = getTrackedChannelValue(newChannel, field);
    if (before !== undefined && after !== undefined && before !== after) changes[field] = { before, after };
  }
  if (Object.keys(changes).length === 0) return undefined;

  return {
    category: "channel",
    guildId: newChannel.guild.id,
    createdAt: new Date().toISOString(),
    channelId: newChannel.id,
    action: "update",
    changes,
  };
}

export function toChannelDeleteLogEntry(channel: DMChannel | NonThreadGuildBasedChannel): LogEntry | undefined {
  if (!isGuildChannel(channel)) return undefined;
  return {
    category: "channel",
    guildId: channel.guild.id,
    createdAt: new Date().toISOString(),
    channelId: channel.id,
    action: "delete",
  };
}

/**
 * 一時VC・制御チャンネルの作成/削除/属性変更は、`channel`カテゴリではなく専用の`tempVoice`カテゴリで
 * 記録される(#413)。監査ログへの反映タイムラグに備えたプロセス内メモリの即時抑制
 * (suppressTempVoiceChannelLog、temp-voice側がAPI呼び出し前後に呼ぶ)を第一段、
 * 監査ログのreason文字列判定(isTempVoiceAuditReason、audit-log-correlation.ts側で実施)を
 * フォールバックとする2段構えの重複記録防止のうち、ここでは第一段のみを扱う。
 */
export function registerChannelHandlers(ctx: FeatureModuleContext, getChannelId: GetChannelId): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx), getChannelId };

  ctx.client.on("channelCreate", (channel) => {
    if (shouldSuppressTempVoiceChannelLog(channel.id)) return;
    writeLogEntrySafely(deps, toChannelCreateLogEntry(channel));
  });
  ctx.client.on("channelUpdate", (oldChannel, newChannel) => {
    if (shouldSuppressTempVoiceChannelLog(newChannel.id)) return;
    const entry = toChannelUpdateLogEntry(oldChannel, newChannel);
    if (entry) writeLogEntrySafely(deps, entry);
  });
  ctx.client.on("channelDelete", (channel) => {
    if (shouldSuppressTempVoiceChannelLog(channel.id)) return;
    const entry = toChannelDeleteLogEntry(channel);
    if (entry) writeLogEntrySafely(deps, entry);
  });
}
