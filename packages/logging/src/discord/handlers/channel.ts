import type { FeatureModuleContext } from "@management-bot/core";
import type { DMChannel, NonThreadGuildBasedChannel } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import type { WriteLogEntryDeps } from "../../application/index.js";
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

export function toChannelUpdateLogEntry(
  oldChannel: DMChannel | NonThreadGuildBasedChannel,
  newChannel: DMChannel | NonThreadGuildBasedChannel,
): LogEntry | undefined {
  if (!isGuildChannel(newChannel)) return undefined;
  return {
    category: "channel",
    guildId: newChannel.guild.id,
    createdAt: new Date().toISOString(),
    channelId: newChannel.id,
    action: "update",
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

export function registerChannelHandlers(ctx: FeatureModuleContext): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx) };

  ctx.client.on("channelCreate", (channel) => writeLogEntrySafely(deps, toChannelCreateLogEntry(channel)));
  ctx.client.on("channelUpdate", (oldChannel, newChannel) => {
    const entry = toChannelUpdateLogEntry(oldChannel, newChannel);
    if (entry) writeLogEntrySafely(deps, entry);
  });
  ctx.client.on("channelDelete", (channel) => {
    const entry = toChannelDeleteLogEntry(channel);
    if (entry) writeLogEntrySafely(deps, entry);
  });
}
