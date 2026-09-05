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
 * log_entriesへのINSERT時にDBトリガー(migrations/0006)が発行するpg_notify('log_entry_inserted', ...)を購読する。
 * LISTENは専用の永続接続を要するため、通常のdrizzleプール(createDb)とは別にpostgres()接続を1本持つ。
 * 不正な形式のpayload(将来のスキーマ変更等)は握りつぶし、購読自体は継続する。
 */
export function listenForLogEntryInserts(
  databaseUrl: string,
  onInsert: (notification: LogEntryInsertNotification) => void,
): { ready: Promise<void>; close: () => Promise<void> } {
  const sql = postgres(databaseUrl);

  const ready = sql
    .listen("log_entry_inserted", (payload) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }
      const result = notificationSchema.safeParse(parsed);
      if (result.success) {
        onInsert(result.data);
      }
    })
    .then(() => undefined);

  return {
    ready,
    close: () => sql.end({ timeout: 5 }),
  };
}
