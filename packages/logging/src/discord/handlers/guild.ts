import type { FeatureModuleContext } from "@management-bot/core";
import type { Guild } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import type { GetChannelId, WriteLogEntryDeps } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";
import { writeLogEntrySafely } from "../write-log-entry-safely.js";

type TrackedGuildValue = string | number | boolean | null;

/** Discordダッシュボード上で直接編集される主要フィールドを追跡対象とする。ownerId(委譲)等の運用系フィールドは対象外。 */
const TRACKED_GUILD_FIELDS = [
  "name",
  "icon",
  "banner",
  "description",
  "verificationLevel",
  "explicitContentFilter",
  "defaultMessageNotifications",
  "afkChannelId",
  "afkTimeout",
  "systemChannelId",
  "rulesChannelId",
  "publicUpdatesChannelId",
  "preferredLocale",
  "widgetEnabled",
  "widgetChannelId",
] as const;

function getTrackedGuildValue(guild: Guild, field: (typeof TRACKED_GUILD_FIELDS)[number]): TrackedGuildValue {
  return guild[field];
}

/** oldGuildとnewGuildを比較し、実際に変化したフィールドのみをchangesに含める。差分がなければundefinedを返す。 */
export function toGuildUpdateLogEntry(oldGuild: Guild, newGuild: Guild): LogEntry | undefined {
  const changes: Record<string, { before: TrackedGuildValue; after: TrackedGuildValue }> = {};
  for (const field of TRACKED_GUILD_FIELDS) {
    const before = getTrackedGuildValue(oldGuild, field);
    const after = getTrackedGuildValue(newGuild, field);
    if (before !== after) changes[field] = { before, after };
  }
  if (Object.keys(changes).length === 0) return undefined;

  return { category: "guild", guildId: newGuild.id, createdAt: new Date().toISOString(), action: "update", changes };
}

export function registerGuildHandlers(ctx: FeatureModuleContext, getChannelId: GetChannelId): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx), getChannelId };

  ctx.client.on("guildUpdate", (oldGuild, newGuild) => {
    const entry = toGuildUpdateLogEntry(oldGuild, newGuild);
    if (entry) writeLogEntrySafely(deps, entry);
  });
}
