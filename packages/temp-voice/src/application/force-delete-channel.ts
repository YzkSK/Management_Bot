import type { DomainEventBus } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import { TEMP_VOICE_DELETE_REASON, suppressTempVoiceChannelLog } from "@management-bot/shared";
import type { Guild } from "discord.js";
import { deleteTempVoiceChannel, findTempVoiceChannel } from "./create-temp-voice-channel.js";

export interface ForceDeleteTempVoiceChannelDeps {
  db: Db;
  eventBus: DomainEventBus;
}

/**
 * Dashboard「強制削除」ボタン由来の削除処理(#415)。handle-empty-channel.tsのfinalizeDeletionと
 * 異なり無人チェックを行わない(在室者を巻き込む削除が仕様、確認ダイアログで在室人数を
 * 警告表示済み)。Discord側の削除→DB削除の順序はfinalizeDeletionと同じ(codexレビュー指摘の
 * 再発防止: 先にDB行を消すとDiscord API失敗時に孤児チャンネルが追跡不能になるため)。
 */
export async function forceDeleteTempVoiceChannel(
  deps: ForceDeleteTempVoiceChannelDeps,
  guild: Guild,
  channelId: string,
  executorId: string,
): Promise<"deleted" | "not_found"> {
  const row = await findTempVoiceChannel(deps.db, channelId);
  if (!row) return "not_found";

  suppressTempVoiceChannelLog(channelId);
  suppressTempVoiceChannelLog(row.controlChannelId);

  const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (channel) {
    await channel.delete(TEMP_VOICE_DELETE_REASON).catch((error: unknown) => {
      console.error(`temp-voice: failed to force-delete channel ${channelId}`, error);
    });
  }
  const controlChannel =
    guild.channels.cache.get(row.controlChannelId) ?? (await guild.channels.fetch(row.controlChannelId).catch(() => null));
  await controlChannel?.delete(TEMP_VOICE_DELETE_REASON).catch((error: unknown) => {
    console.error(`temp-voice: failed to delete control channel ${row.controlChannelId}`, error);
  });

  await deleteTempVoiceChannel(deps.db, channelId);

  await deps.eventBus.publish({
    type: "temp-voice.event.recorded",
    action: "deleted",
    guildId: row.guildId,
    channelId,
    ownerId: row.ownerId,
    executorId,
    createdAt: new Date().toISOString(),
  });

  return "deleted";
}
