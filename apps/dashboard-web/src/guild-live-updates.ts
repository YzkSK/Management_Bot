import { GUILD_DATA_TOPICS, guildDataChangedMessageSchema, type GuildDataTopic } from "@management-bot/shared";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** 連続した変更(例: 設定の一括保存)で同じtopicのクエリを叩きすぎないよう、topicごとにまとめる時間。 */
export const GUILD_DATA_INVALIDATE_DELAY_MS = 300;

/** dashboard-apiの/ws/guild/:guildIdが送るJSONメッセージを検証し、topicを返す。不正なら無視するためnull。 */
export function parseGuildDataMessage(data: string): GuildDataTopic | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  const result = guildDataChangedMessageSchema.safeParse(parsed);
  return result.success ? result.data.topic : null;
}

/**
 * topicごとに、最初の通知から一定時間後に1回だけ対応クエリをinvalidateする(trailing throttle)。
 * 通知が途切れず続いても再取得が先送りされ続けないよう、タイマーは延長しない。
 * notifyAllは再接続時の取りこぼし回収用(全topic)。
 */
export function createGuildDataInvalidator(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  keysFor: (topic: GuildDataTopic) => readonly QueryKey[],
  delayMs: number = GUILD_DATA_INVALIDATE_DELAY_MS,
): { notify(topic: GuildDataTopic): void; notifyAll(): void; dispose(): void } {
  const timers = new Map<GuildDataTopic, ReturnType<typeof setTimeout>>();

  const notify = (topic: GuildDataTopic): void => {
    if (timers.has(topic)) return;
    timers.set(
      topic,
      setTimeout(() => {
        timers.delete(topic);
        for (const queryKey of keysFor(topic)) void queryClient.invalidateQueries({ queryKey });
      }, delayMs),
    );
  };

  return {
    notify,
    notifyAll: () => GUILD_DATA_TOPICS.forEach(notify),
    dispose: () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    },
  };
}
