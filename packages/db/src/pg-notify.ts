import postgres from "postgres";

/**
 * pg_notifyの1チャンネルを購読し、パース済みpayloadをコールバックに渡す薄いヘルパー。
 * LISTENは専用の永続接続を要するため、通常のdrizzleプール(createDb)とは別にpostgres()接続を1本持つ。
 * 不正な形式のpayload(将来のスキーマ変更等)は握りつぶし、購読自体は継続する。
 * log-entry-notifications.ts / moderation-config-notifications.tsで共用する。
 */
export function listenForNotification<T>(
  databaseUrl: string,
  channel: string,
  parse: (payload: unknown) => T | null,
  onNotify: (notification: T) => void,
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
      const result = parse(parsed);
      if (result !== null) onNotify(result);
    })
    .then(() => undefined);

  return {
    ready,
    close: () => sql.end({ timeout: 5 }),
  };
}
