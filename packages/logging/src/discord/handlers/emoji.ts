import type { FeatureModuleContext } from "@management-bot/core";
import type { GuildEmoji } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import type { GetChannelId } from "../../application/index.js";
import { createWriteLogEntryDeps, writeLogEntrySafely } from "../write-log-entry-safely.js";

export function toEmojiCreateLogEntry(emoji: GuildEmoji): LogEntry {
  return { category: "emoji", guildId: emoji.guild.id, createdAt: new Date().toISOString(), emojiId: emoji.id, action: "create" };
}

export function toEmojiUpdateLogEntry(_oldEmoji: GuildEmoji, newEmoji: GuildEmoji): LogEntry {
  return {
    category: "emoji",
    guildId: newEmoji.guild.id,
    createdAt: new Date().toISOString(),
    emojiId: newEmoji.id,
    action: "update",
  };
}

export function toEmojiDeleteLogEntry(emoji: GuildEmoji): LogEntry {
  return { category: "emoji", guildId: emoji.guild.id, createdAt: new Date().toISOString(), emojiId: emoji.id, action: "delete" };
}

export function registerEmojiHandlers(ctx: FeatureModuleContext, getChannelId: GetChannelId): void {
  const deps = createWriteLogEntryDeps(ctx, getChannelId);

  ctx.client.on("emojiCreate", (emoji) => writeLogEntrySafely(deps, toEmojiCreateLogEntry(emoji)));
  ctx.client.on("emojiUpdate", (oldEmoji, newEmoji) => writeLogEntrySafely(deps, toEmojiUpdateLogEntry(oldEmoji, newEmoji)));
  ctx.client.on("emojiDelete", (emoji) => writeLogEntrySafely(deps, toEmojiDeleteLogEntry(emoji)));
}
