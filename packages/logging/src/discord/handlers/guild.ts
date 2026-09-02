import type { FeatureModuleContext } from "@management-bot/core";
import type { Guild } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import type { WriteLogEntryDeps } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";
import { writeLogEntrySafely } from "../write-log-entry-safely.js";

/** guildカテゴリのaction値はupdateしかない(schema参照)。名前変更・アイコン変更等すべてここに集約される。 */
export function toGuildUpdateLogEntry(newGuild: Guild): LogEntry {
  return { category: "guild", guildId: newGuild.id, createdAt: new Date().toISOString(), action: "update" };
}

export function registerGuildHandlers(ctx: FeatureModuleContext): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx) };

  ctx.client.on("guildUpdate", (_oldGuild, newGuild) => writeLogEntrySafely(deps, toGuildUpdateLogEntry(newGuild)));
}
