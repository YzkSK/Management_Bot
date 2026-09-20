import { PermissionFlagsBits, type Guild, type GuildBasedChannel, type ThreadChannel } from "discord.js";
import type { Db } from "@management-bot/db";
import {
  clearLockdownChannelSnapshots,
  getLockdownSettings,
  listLockdownChannelSnapshots,
  markLockdownApplied,
  saveLockdownChannelSnapshots,
} from "../application/index.js";

function isLockdownChannel(channel: GuildBasedChannel): channel is Exclude<GuildBasedChannel, ThreadChannel> {
  return channel.isTextBased() && !channel.isThread();
}

function getSendMessagesOverwrite(channel: Exclude<GuildBasedChannel, ThreadChannel>, guildId: string): boolean | null {
  const overwrite = channel.permissionOverwrites.cache.get(guildId);
  if (!overwrite) return null;
  if (overwrite.allow.has(PermissionFlagsBits.SendMessages)) return true;
  if (overwrite.deny.has(PermissionFlagsBits.SendMessages)) return false;
  return null;
}

/**
 * Dashboardまたはレイド検知で要求されたロック状態をDiscordへ反映する。
 * 権限変更に失敗したときはsnapshotと状態を残し、次回の同期待ちで再試行できる。
 */
export async function synchronizeLockdown(db: Db, guild: Guild): Promise<"locked" | "released" | "unchanged"> {
  const settings = await getLockdownSettings(db, guild.id);
  if (settings.requestedLocked && !settings.isLocked) {
    const channels = [...guild.channels.cache.values()].filter(isLockdownChannel);
    await saveLockdownChannelSnapshots(
      db,
      guild.id,
      channels.map((channel) => ({
        channelId: channel.id,
        sendMessages: getSendMessagesOverwrite(channel, guild.id),
      })),
    );
    for (const channel of channels) {
      await channel.permissionOverwrites.edit(guild.id, { SendMessages: false });
    }
    await markLockdownApplied(db, guild.id, true);
    return "locked";
  }

  if (!settings.requestedLocked && settings.isLocked) {
    const snapshots = await listLockdownChannelSnapshots(db, guild.id);
    for (const snapshot of snapshots) {
      const channel = guild.channels.cache.get(snapshot.channelId);
      if (!channel || !isLockdownChannel(channel)) continue;
      await channel.permissionOverwrites.edit(guild.id, { SendMessages: snapshot.sendMessages });
    }
    await clearLockdownChannelSnapshots(db, guild.id);
    await markLockdownApplied(db, guild.id, false);
    return "released";
  }

  return "unchanged";
}
