import { tempVoiceChannels, type Db } from "@management-bot/db";
import {
  DOMAIN_EVENT_SCHEMAS,
  HEARTBEAT_STALE_MS,
  INFRA_STATUS_KEY,
  infraHeartbeatSchema,
  type InfraHeartbeat,
} from "@management-bot/shared";
import { count, sql } from "drizzle-orm";
import type { Redis } from "ioredis";

export type ServiceState = "ok" | "warn" | "down";

export const STATUS_KEYS = [
  "bot",
  "api",
  "postgres",
  "redis",
  "activity",
  "logging",
  "tempVoice",
  "moderation",
  "backup",
  "sessionCleanup",
] as const;
export type StatusKey = (typeof STATUS_KEYS)[number];

export interface StatusItem {
  key: StatusKey;
  state: ServiceState;
  /** 定期ジョブの最終実行時刻(ISO)。 */
  lastRunAt: string | null;
  /** 画面の補足表示に使う数値(pingMs, guilds, connections等)。 */
  values: Record<string, number>;
}

export interface StatusOverview {
  checkedAt: string;
  summary: ServiceState;
  items: StatusItem[];
}

/** これを超える未処理イベント数で「遅延」とする。 */
export const LOGGING_LAG_WARN = 100;
export const BOT_PING_WARN_MS = 1000;
export const PG_CONNECTION_WARN_RATIO = 0.8;

const RANK: Record<ServiceState, number> = { ok: 0, warn: 1, down: 2 };
export const worst = (states: readonly ServiceState[]): ServiceState =>
  states.reduce<ServiceState>((a, b) => (RANK[b] > RANK[a] ? b : a), "ok");

const isStale = (hb: InfraHeartbeat | undefined, now: Date) =>
  !hb || now.getTime() - Date.parse(hb.aliveAt) > HEARTBEAT_STALE_MS;

/** 定期ジョブ: ハートビートが途絶えたか直近の実行が失敗していれば停止。 */
export function evaluateWorker(hb: InfraHeartbeat | undefined, now: Date): ServiceState {
  if (isStale(hb, now) || hb?.lastOk === false) return "down";
  return "ok";
}

export function evaluateBot(hb: InfraHeartbeat | undefined, now: Date): ServiceState {
  if (isStale(hb, now) || hb?.detail?.ready === 0) return "down";
  return (hb?.detail?.pingMs ?? 0) > BOT_PING_WARN_MS ? "warn" : "ok";
}

export function parseHeartbeats(raw: Record<string, string>): Map<string, InfraHeartbeat> {
  const result = new Map<string, InfraHeartbeat>();
  for (const [name, value] of Object.entries(raw)) {
    try {
      const parsed = infraHeartbeatSchema.safeParse(JSON.parse(value));
      if (parsed.success) result.set(name, parsed.data);
    } catch {
      // 壊れたエントリは未報告扱い
    }
  }
  return result;
}

/** `XINFO GROUPS`の応答(フィールド名と値の交互配列の配列)から指定groupの未処理件数(lag+pending)を取り出す。 */
export function pendingFromXinfoGroups(reply: unknown, group: string): number {
  if (!Array.isArray(reply)) return 0;
  for (const row of reply) {
    if (!Array.isArray(row)) continue;
    const fields = new Map<string, unknown>();
    for (let i = 0; i + 1 < row.length; i += 2) fields.set(String(row[i]), row[i + 1]);
    if (fields.get("name") !== group) continue;
    const lag = Number(fields.get("lag"));
    const pending = Number(fields.get("pending"));
    return (Number.isFinite(lag) ? lag : 0) + (Number.isFinite(pending) ? pending : 0);
  }
  return 0;
}

/** Redis `INFO memory`の応答からused_memory(バイト)を取り出す。 */
export function usedMemoryFromInfo(info: string): number | null {
  const match = /^used_memory:(\d+)/m.exec(info);
  return match ? Number(match[1]) : null;
}

async function settle<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise;
  } catch {
    return undefined;
  }
}

export async function collectStatus(db: Db, redis: Redis, now = () => new Date()): Promise<StatusOverview> {
  const startedAt = performance.now();

  const pgQuery = db.execute<{ used: number; max: number }>(
    sql`SELECT count(*)::int AS used, current_setting('max_connections')::int AS max FROM pg_stat_activity`,
  );
  const [heartbeatsRaw, memoryInfo, pgRows, tempVoiceRows, loggingPending] = await Promise.all([
    settle(redis.hgetall(INFRA_STATUS_KEY)),
    settle(redis.info("memory")),
    settle(Promise.resolve(pgQuery)),
    settle(db.select({ n: count() }).from(tempVoiceChannels)),
    settle(
      Promise.all(
        Object.keys(DOMAIN_EVENT_SCHEMAS).map((type) =>
          redis.xinfo("GROUPS", `domain-events:${type}`).then(
            (reply) => pendingFromXinfoGroups(reply, "logging"),
            () => 0, // stream未作成
          ),
        ),
      ).then((values) => values.reduce((a, b) => a + b, 0)),
    ),
  ]);

  const at = now();
  const hbs = parseHeartbeats(heartbeatsRaw ?? {});
  const worker = (name: string, key: StatusKey): StatusItem => {
    const hb = hbs.get(name);
    return { key, state: evaluateWorker(hb, at), lastRunAt: hb?.lastRunAt ?? null, values: {} };
  };

  const botHb = hbs.get("bot");
  const botState = evaluateBot(botHb, at);
  const pg = pgRows?.[0];
  const usedMemory = memoryInfo === undefined ? null : usedMemoryFromInfo(memoryInfo);
  const retention = worker("logging-retention", "logging");
  const pending = loggingPending ?? 0;

  const items: StatusItem[] = [
    { key: "bot", state: botState, lastRunAt: null, values: { ...botHb?.detail } },
    { key: "api", state: "ok", lastRunAt: null, values: { responseMs: Math.round(performance.now() - startedAt) } },
    {
      key: "postgres",
      state: !pg ? "down" : pg.used / pg.max > PG_CONNECTION_WARN_RATIO ? "warn" : "ok",
      lastRunAt: null,
      values: pg ? { connections: pg.used, maxConnections: pg.max } : {},
    },
    {
      key: "redis",
      state: usedMemory === null ? "down" : "ok",
      lastRunAt: null,
      values: usedMemory === null ? {} : { usedMemoryBytes: usedMemory },
    },
    worker("activity-rollup", "activity"),
    {
      ...retention,
      state: worst([retention.state, botState === "down" ? "down" : "ok", pending > LOGGING_LAG_WARN ? "warn" : "ok"]),
      values: { pendingEvents: pending },
    },
    {
      key: "tempVoice",
      state: botState === "down" ? "down" : "ok",
      lastRunAt: null,
      values: tempVoiceRows?.[0] ? { channels: tempVoiceRows[0].n } : {},
    },
    worker("moderation-decay", "moderation"),
    worker("backup", "backup"),
    worker("session-cleanup", "sessionCleanup"),
  ];

  return { checkedAt: at.toISOString(), summary: worst(items.map((item) => item.state)), items };
}
