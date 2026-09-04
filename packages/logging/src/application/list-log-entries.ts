import type { Db } from "@management-bot/db";
import { logEntries } from "@management-bot/db";
import type { LogCategory } from "@management-bot/shared";
import { and, desc, eq, lt } from "drizzle-orm";
import { parseLogEntry, type LogEntry } from "../domain/index.js";

export interface ListLogEntriesInput {
  guildId: string;
  category?: LogCategory;
  limit: number;
  /** 前ページ最終行のcreatedAt(ISO文字列)。これより古いエントリを返す。 */
  cursor?: string;
}

export interface ListLogEntriesResult {
  entries: Array<{ id: string; entry: LogEntry }>;
  nextCursor: string | null;
}

/**
 * createdAt降順のcursorベースページネーション。同一ミリ秒に複数エントリが存在する場合、
 * カーソル境界でごく稀に1件飛ばす/重複し得るが、ログ閲覧用途でありミリ秒衝突は実運用上無視できる想定。
 */
export async function listLogEntries(
  db: Db,
  input: ListLogEntriesInput,
): Promise<ListLogEntriesResult> {
  const conditions = [eq(logEntries.guildId, input.guildId)];
  if (input.category) conditions.push(eq(logEntries.category, input.category));
  if (input.cursor) conditions.push(lt(logEntries.createdAt, new Date(input.cursor)));

  const rows = await db
    .select({ id: logEntries.id, payload: logEntries.payload, createdAt: logEntries.createdAt })
    .from(logEntries)
    .where(and(...conditions))
    .orderBy(desc(logEntries.createdAt))
    .limit(input.limit);

  return {
    entries: rows.map((row) => ({ id: row.id, entry: parseLogEntry(row.payload) })),
    nextCursor:
      rows.length === input.limit ? (rows[rows.length - 1]?.createdAt.toISOString() ?? null) : null,
  };
}

/**
 * VIEW_LOGS_RAWを持たない閲覧者向けに、メッセージ本文など生データを含むフィールドを取り除く。
 * VIEW_LOGSのみでは要約(誰が・いつ・何をしたか)のみ見える想定。
 */
export function maskSensitiveFields(entry: LogEntry): LogEntry {
  if (entry.category === "message" && entry.content !== undefined) {
    return { ...entry, content: undefined };
  }
  return entry;
}
