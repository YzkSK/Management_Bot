import { discordIdSchema, guildDataTopicSchema, type GuildDataTopic } from "@management-bot/shared";
import { z } from "zod";
import { listenForNotification } from "./pg-notify.js";

export interface GuildDataChangedNotification {
  guildId: string;
  topic: GuildDataTopic;
}

const notificationSchema = z.object({ guildId: discordIdSchema, topic: guildDataTopicSchema });

/**
 * 各機能テーブルの変更(INSERT/UPDATE/DELETE)時にDBトリガー(migrations/0040)が発行する
 * pg_notify('guild_data_changed', ...)を購読する。Dashboardのリアルタイム更新(#643)用。
 */
export function listenForGuildDataChanges(
  databaseUrl: string,
  onChange: (notification: GuildDataChangedNotification) => void,
): { ready: Promise<void>; close: () => Promise<void> } {
  return listenForNotification(databaseUrl, "guild_data_changed", (payload) => {
    const result = notificationSchema.safeParse(payload);
    return result.success ? result.data : null;
  }, onChange);
}
