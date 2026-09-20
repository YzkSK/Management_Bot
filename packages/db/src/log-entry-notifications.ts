import { discordIdSchema } from "@management-bot/shared";
import { z } from "zod";
import { listenForNotification } from "./pg-notify.js";

export interface LogEntryInsertNotification {
  guildId: string;
  category: string;
}

const notificationSchema = z.object({
  guildId: discordIdSchema,
  category: z.string().min(1),
});

function parseNotification(payload: unknown): { guildId: string; category: string } | null {
  const result = notificationSchema.safeParse(payload);
  return result.success ? result.data : null;
}

/** log_entriesへのINSERT時にDBトリガー(migrations/0006)が発行するpg_notify('log_entry_inserted', ...)を購読する。 */
export function listenForLogEntryInserts(
  databaseUrl: string,
  onInsert: (notification: LogEntryInsertNotification) => void,
): { ready: Promise<void>; close: () => Promise<void> } {
  return listenForNotification(databaseUrl, "log_entry_inserted", parseNotification, onInsert);
}

export interface LogChannelSettingChangedNotification {
  guildId: string;
  category: string;
}

/**
 * log_channel_settingsの変更(INSERT/UPDATE/DELETE)時にDBトリガー(migrations/0013)が発行する
 * pg_notify('log_channel_setting_changed', ...)を購読する。bot側の短命TTLキャッシュ
 * (packages/logging createChannelSettingResolver)をTTL満了前に即時invalidateするために使う。
 */
export function listenForLogChannelSettingChanges(
  databaseUrl: string,
  onChange: (notification: LogChannelSettingChangedNotification) => void,
): { ready: Promise<void>; close: () => Promise<void> } {
  return listenForNotification(databaseUrl, "log_channel_setting_changed", parseNotification, onChange);
}
