import { ACTIVITY_CHANGED_PATTERN, parseActivityChanged } from "@management-bot/activity";
import type { Redis } from "ioredis";
import { createGuildBroadcaster } from "./log-broadcaster.js";

export const activityClients = createGuildBroadcaster("activity");

/** botからのRedis Pub/Sub通知を該当guildの画面へ中継する。不正な通知は無視する。 */
export function handleActivityChanged(channel: string, message: string): void {
  const change = parseActivityChanged(channel, message);
  if (!change) return;
  activityClients.broadcast(change.guildId, JSON.stringify({ type: "activityChanged", kind: change.kind }));
}

/** 接続ごとに購読せず、プロセスで1つのsubscriberから全guildへ振り分ける。 */
export async function subscribeActivityChanges(redis: Redis): Promise<void> {
  const sub = redis.duplicate();
  sub.on("pmessage", (_pattern: string, channel: string, message: string) => handleActivityChanged(channel, message));
  await sub.psubscribe(ACTIVITY_CHANGED_PATTERN);
}
