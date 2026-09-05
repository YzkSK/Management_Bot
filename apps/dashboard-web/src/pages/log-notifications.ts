import { z } from "zod";

/** dashboard-apiのlog-broadcasterが送るJSONメッセージの形。 */
const notificationSchema = z.object({
  type: z.literal("newLogEntry"),
  category: z.string().min(1),
});

export function parseLogNotificationMessage(data: string): { category: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  const result = notificationSchema.safeParse(parsed);
  return result.success ? { category: result.data.category } : null;
}

/** http(s)://host/... -> ws(s)://host/ws/logs/:guildId */
export function buildLogWsUrl(apiUrl: string, guildId: string): string {
  const url = new URL(apiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/ws/logs/${guildId}`;
  return url.toString();
}

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

/**
 * 切断からの再接続待機時間(full jitter: 0〜指数バックオフ上限のランダム値)。attemptは1から。
 * 多数のクライアントが同時切断した際に一斉再接続してサーバーへ負荷が集中するのを避ける。
 */
export function nextReconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const cap = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  return Math.round(random() * cap);
}
