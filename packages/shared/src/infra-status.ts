import { z } from "zod";

/**
 * Bot全体ステータス画面(issue #507)用の基盤ログ・稼働状況をRedisでやり取りするための定義。
 * 各プロセスはconsole出力を上限付きStream(INFRA_LOG_STREAM)へ複製し、稼働状況をHash(INFRA_STATUS_KEY)へ
 * 定期的に書き込む。dashboard-apiがそれらを集約して返す。
 */
export const INFRA_LOG_STREAM = "infra:logs";
/** XADD MAXLEN ~ の上限。古いログはRedisが自動で削除する。 */
export const INFRA_LOG_MAXLEN = 5000;
export const INFRA_STATUS_KEY = "infra:status";
/** PostgreSQL/Redisのログ行をVectorサイドカーから受け取るPub/Subチャンネル。 */
export const INFRA_LOG_INGEST_CHANNEL = "infra:logs:ingest";
export const HEARTBEAT_INTERVAL_MS = 30_000;
/** ハートビートがこれより古ければ停止とみなす(書き込み間隔の3倍)。 */
export const HEARTBEAT_STALE_MS = HEARTBEAT_INTERVAL_MS * 3;

export const INFRA_LOG_SERVICES = ["bot", "api", "worker", "postgres", "redis"] as const;
export type InfraLogService = (typeof INFRA_LOG_SERVICES)[number];
export const INFRA_LOG_LEVELS = ["DEBUG", "INFO", "LOG", "WARN", "ERROR"] as const;
export type InfraLogLevel = (typeof INFRA_LOG_LEVELS)[number];

export const infraLogEntrySchema = z.object({
  at: z.string(),
  service: z.enum(INFRA_LOG_SERVICES),
  level: z.enum(INFRA_LOG_LEVELS),
  scope: z.string(),
  msg: z.string(),
});
export type InfraLogEntry = z.infer<typeof infraLogEntrySchema>;

export const infraHeartbeatSchema = z.object({
  aliveAt: z.string(),
  /** 定期ジョブの最終実行時刻と成否。常駐プロセス(bot等)では省略する。 */
  lastRunAt: z.string().optional(),
  lastOk: z.boolean().optional(),
  detail: z.record(z.string(), z.number()).optional(),
});
export type InfraHeartbeat = z.infer<typeof infraHeartbeatSchema>;

/** ioredisのRedisが構造的に満たす最小インターフェース(sharedをioredisに依存させないため)。 */
export interface InfraRedisClient {
  xadd(key: string, ...args: string[]): Promise<unknown>;
  hset(key: string, field: string, value: string): Promise<unknown>;
}

export interface InfraReporter {
  /** 定期ジョブの実行結果を記録し、即座にハートビートへ反映する。 */
  recordRun(ok: boolean): void;
  /** 画面に出す数値(Gateway ping等)を差し替える。次のハートビートで反映する。 */
  setDetail(detail: Record<string, number>): void;
  stop(): void;
}

const CONSOLE_LEVELS = { debug: "DEBUG", log: "INFO", info: "INFO", warn: "WARN", error: "ERROR" } as const;

export function formatConsoleArgs(args: readonly unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`;
      try {
        return JSON.stringify(arg) ?? String(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

export function appendInfraLog(redis: InfraRedisClient, entry: InfraLogEntry): Promise<unknown> {
  return redis.xadd(INFRA_LOG_STREAM, "MAXLEN", "~", String(INFRA_LOG_MAXLEN), "*", "entry", JSON.stringify(entry));
}

/**
 * consoleを包んで出力をStreamへ複製し、`name`でハートビートを書き込み続ける。
 * Redisへの書き込み失敗は握りつぶす(ログ送信の失敗をconsole.errorするとループするため)。
 */
export function startInfraReporter(
  redis: InfraRedisClient,
  { name, service, now = () => new Date() }: { name: string; service: InfraLogService; now?: () => Date },
): InfraReporter {
  const state: InfraHeartbeat = { aliveAt: now().toISOString() };
  const originals = new Map<keyof typeof CONSOLE_LEVELS, (...args: unknown[]) => void>();

  for (const method of Object.keys(CONSOLE_LEVELS) as (keyof typeof CONSOLE_LEVELS)[]) {
    const original = console[method];
    originals.set(method, original);
    console[method] = (...args: unknown[]) => {
      original.apply(console, args);
      const entry = { at: now().toISOString(), service, level: CONSOLE_LEVELS[method], scope: name, msg: formatConsoleArgs(args) };
      appendInfraLog(redis, entry).catch(() => {});
    };
  }

  const writeHeartbeat = () => {
    state.aliveAt = now().toISOString();
    redis.hset(INFRA_STATUS_KEY, name, JSON.stringify(state)).catch(() => {});
  };
  writeHeartbeat();
  const timer = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);
  timer.unref?.();

  return {
    recordRun(ok) {
      state.lastRunAt = now().toISOString();
      state.lastOk = ok;
      writeHeartbeat();
    },
    setDetail(detail) {
      state.detail = detail;
    },
    stop() {
      clearInterval(timer);
      for (const [method, original] of originals) console[method] = original;
    },
  };
}
