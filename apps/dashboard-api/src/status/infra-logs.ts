import {
  appendInfraLog,
  INFRA_LOG_INGEST_CHANNEL,
  INFRA_LOG_MAXLEN,
  INFRA_LOG_STREAM,
  infraLogEntrySchema,
  type InfraLogEntry,
  type InfraLogLevel,
  type InfraLogService,
} from "@management-bot/shared";
import type { Redis } from "ioredis";
import { z } from "zod";

type ParsedLine = Pick<InfraLogEntry, "level" | "scope" | "msg">;

const PG_LEVELS: Record<string, InfraLogLevel> = {
  WARNING: "WARN",
  ERROR: "ERROR",
  FATAL: "ERROR",
  PANIC: "ERROR",
  INFO: "INFO",
  NOTICE: "INFO",
};

const pgJsonLogSchema = z.object({ error_severity: z.string(), message: z.string() });

/**
 * log_destination=jsonlogの1行(1エントリ)。テキスト形式は値の改行で偽の行を作れるためJSONのみ受け付け、
 * 解釈できない行はそのまま本文として扱う(issue #568)。
 */
export function parsePostgresLine(line: string): ParsedLine {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { level: "LOG", scope: "postgres", msg: line };
  }
  const parsed = pgJsonLogSchema.safeParse(raw);
  if (!parsed.success) return { level: "LOG", scope: "postgres", msg: line };
  const { error_severity: severity, message } = parsed.data;
  const level = PG_LEVELS[severity] ?? (severity.startsWith("DEBUG") ? "DEBUG" : "LOG");
  return { level, scope: "postgres", msg: message };
}

/** `pid:role 30 Sep 2026 10:00:00.123 * message`形式。`#`が警告、`.`がデバッグ。 */
export function parseRedisLine(line: string): ParsedLine {
  const match = /^\d+:[A-Z] .+? \d\d:\d\d:\d\d\.\d+ ([.\-*#]) (.*)$/.exec(line);
  if (!match) return { level: "INFO", scope: "server", msg: line };
  const [, mark, msg = ""] = match;
  return { level: mark === "#" ? "WARN" : mark === "." ? "DEBUG" : "INFO", scope: "server", msg };
}

const ingestSchema = z.object({ service: z.enum(["postgres", "redis"]), line: z.string() });

/** Vectorサイドカーから届いた1行を基盤ログのエントリへ変換する。不正な通知はnull。 */
export function toInfraLogEntry(message: string, now: Date): InfraLogEntry | null {
  let raw: unknown;
  try {
    raw = JSON.parse(message);
  } catch {
    return null;
  }
  const parsed = ingestSchema.safeParse(raw);
  if (!parsed.success || parsed.data.line.trim() === "") return null;
  const { service, line } = parsed.data;
  // ponytail: 時刻は受信時刻を使う(Vectorはほぼ即時に転送するため)。各行の時刻書式を解釈しない。
  return { at: now.toISOString(), service, ...(service === "postgres" ? parsePostgresLine(line) : parseRedisLine(line)) };
}

/**
 * VectorのredisシンクはStreamsに書けない(list/channel/sortedsetのみ)ため、Pub/Subで受けて
 * Bot/API/ワーカーと同じ上限付きStreamへ積み直す。API停止中に届いた行は失われる(許容)。
 */
export async function subscribeInfraLogIngest(redis: Redis): Promise<void> {
  const sub = redis.duplicate();
  sub.on("message", (_channel: string, message: string) => {
    const entry = toInfraLogEntry(message, new Date());
    if (entry) appendInfraLog(redis, entry).catch(() => {});
  });
  await sub.subscribe(INFRA_LOG_INGEST_CHANNEL);
}

export const LOG_PAGE_SIZE = 300;

/** XREVRANGEの応答([id, [field, value, ...]][])から有効なエントリだけを新しい順に取り出す。 */
export function parseLogStream(reply: readonly [string, string[]][]): InfraLogEntry[] {
  const entries: InfraLogEntry[] = [];
  for (const [, fields] of reply) {
    const index = fields.indexOf("entry");
    const value = index >= 0 ? fields[index + 1] : undefined;
    if (value === undefined) continue;
    try {
      const parsed = infraLogEntrySchema.safeParse(JSON.parse(value));
      if (parsed.success) entries.push(parsed.data);
    } catch {
      // 壊れたエントリは読み飛ばす
    }
  }
  return entries;
}

/**
 * ponytail: サービス別表示でも保持分(最大INFRA_LOG_MAXLEN件)を毎回読んでから絞り込む。
 * 閲覧者はオーナー等の数人に限られるため許容。重くなったらサービス別Streamに分ける。
 */
export async function readInfraLogs(redis: Redis, service: InfraLogService | undefined): Promise<InfraLogEntry[]> {
  const reply = await redis.xrevrange(INFRA_LOG_STREAM, "+", "-", "COUNT", INFRA_LOG_MAXLEN);
  return parseLogStream(reply)
    .filter((entry) => service === undefined || entry.service === service)
    .slice(0, LOG_PAGE_SIZE);
}
