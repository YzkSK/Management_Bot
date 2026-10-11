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

/** サーバーのリソース使用状況(issue #548)。dashboard-apiがcAdvisorから採取してListへ積む。 */
export const INFRA_RESOURCES_KEY = "infra:resources";
export const RESOURCE_SAMPLE_INTERVAL_MS = 60_000;
/** 1分間隔で7日分。 */
export const RESOURCE_SAMPLE_MAXLEN = 10_080;

export const resourceSampleSchema = z.object({
  at: z.string(),
  host: z.object({
    cpuPercent: z.number(),
    memUsedBytes: z.number(),
    memTotalBytes: z.number(),
    diskUsedBytes: z.number(),
    diskTotalBytes: z.number(),
    netRxBytesPerSec: z.number(),
    netTxBytesPerSec: z.number(),
    cores: z.number(),
  }),
  containers: z.array(
    z.object({ name: z.string(), cpuPercent: z.number(), memUsedBytes: z.number(), startedAt: z.string() }),
  ),
});
export type ResourceSample = z.infer<typeof resourceSampleSchema>;

/**
 * バックアップ一覧と手動実行(issue #629)。backupコンテナとdashboard-apiはボリュームを共有しないため、
 * 一覧はbackup側がRedisへ書き、手動実行の要求はdashboard-apiがキーを立ててbackup側がポーリングで拾う。
 */
export const BACKUP_REQUEST_KEY = "infra:backup:request";
export const BACKUP_FILES_KEY = "infra:backup:files";
export const BACKUP_REQUEST_POLL_MS = 10_000;

export const backupFileSchema = z.object({ name: z.string(), sizeBytes: z.number(), createdAt: z.string() });
export type BackupFile = z.infer<typeof backupFileSchema>;
export const backupFilesSchema = z.object({ updatedAt: z.string(), files: z.array(backupFileSchema) });
export type BackupFiles = z.infer<typeof backupFilesSchema>;

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
  /** 画面に出す数値(Gateway ping等)を差し替え、即座にハートビートへ反映する。 */
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
      writeHeartbeat();
    },
    stop() {
      clearInterval(timer);
      for (const [method, original] of originals) console[method] = original;
    },
  };
}
