import type { Db } from "@management-bot/db";
import { logEntries } from "@management-bot/db";
import type { LogCategory } from "@management-bot/shared";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { z } from "zod";
import { parseLogEntry, type LogEntry } from "../domain/index.js";

const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.string().min(1) });
export type LogEntryCursor = z.infer<typeof cursorSchema>;

/** createdAt+idの複合カーソルを不透明な文字列にエンコードする。 */
export function encodeCursor(cursor: LogEntryCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

/** 不正なカーソル文字列(改ざん・破損)はZodErrorを投げる。呼び出し側でBAD_REQUESTに変換すること。 */
export function decodeCursor(cursor: string): LogEntryCursor {
  const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  return cursorSchema.parse(decoded);
}

export interface ListLogEntriesInput {
  guildId: string;
  category?: LogCategory;
  limit: number;
  /** 前ページ最終行からencodeCursorで得たカーソル。これより古いエントリを返す。 */
  cursor?: string;
}

export interface ListLogEntriesResult {
  entries: Array<{ id: string; entry: LogEntry }>;
  nextCursor: string | null;
}

/**
 * (createdAt, id)の複合カーソルによるcursorベースページネーション。
 * 同一createdAtが複数存在してもidで一意に順序付けられるため、境界での欠落・重複は起きない。
 * hasMore判定のためlimit+1件取得し、余分な1件は返却entriesに含めない。
 */
export async function listLogEntries(
  db: Db,
  input: ListLogEntriesInput,
): Promise<ListLogEntriesResult> {
  const conditions = [eq(logEntries.guildId, input.guildId)];
  if (input.category) conditions.push(eq(logEntries.category, input.category));
  if (input.cursor) {
    const cursor = decodeCursor(input.cursor);
    const cursorCreatedAt = new Date(cursor.createdAt);
    conditions.push(
      or(
        lt(logEntries.createdAt, cursorCreatedAt),
        and(eq(logEntries.createdAt, cursorCreatedAt), lt(logEntries.id, cursor.id)),
      )!,
    );
  }

  const rows = await db
    .select({ id: logEntries.id, payload: logEntries.payload, createdAt: logEntries.createdAt })
    .from(logEntries)
    .where(and(...conditions))
    .orderBy(desc(logEntries.createdAt), desc(logEntries.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];

  return {
    entries: page.map((row) => ({ id: row.id, entry: parseLogEntry(row.payload) })),
    nextCursor:
      hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
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
