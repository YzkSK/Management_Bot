import postgres from "postgres";
import { z } from "zod";

export interface LogEntryInsertNotification {
  guildId: string;
  category: string;
}

const notificationSchema = z.object({
  guildId: z.string().min(1),
  category: z.string().min(1),
});

/**
 * pg_notifyの1チャンネルを購読し、パース済みpayloadをコールバックに渡す薄いヘルパー。
 * LISTENは専用の永続接続を要するため、通常のdrizzleプール(createDb)とは別にpostgres()接続を1本持つ。
 * 不正な形式のpayload(将来のスキーマ変更等)は握りつぶし、購読自体は継続する。
 */
function listenForNotification(
  databaseUrl: string,
  channel: string,
  onNotify: (notification: { guildId: string; category: string }) => void,
): { ready: Promise<void>; close: () => Promise<void> } {
  const sql = postgres(databaseUrl);

  const ready = sql
    .listen(channel, (payload) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }
      const result = notificationSchema.safeParse(parsed);
      if (result.success) {
        onNotify(result.data);
      }
    })
    .then(() => undefined);

  return {
    ready,
    close: () => sql.end({ timeout: 5 }),
  };
}

/** log_entriesへのINSERT時にDBトリガー(migrations/0006)が発行するpg_notify('log_entry_inserted', ...)を購読する。 */
export function listenForLogEntryInserts(
  databaseUrl: string,
  onInsert: (notification: LogEntryInsertNotification) => void,
): { ready: Promise<void>; close: () => Promise<void> } {
  return listenForNotification(databaseUrl, "log_entry_inserted", onInsert);
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
  return listenForNotification(databaseUrl, "log_channel_setting_changed", onChange);
}
