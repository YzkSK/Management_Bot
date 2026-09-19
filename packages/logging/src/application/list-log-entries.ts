import type { Db } from "@management-bot/db";
import { logEntries } from "@management-bot/db";
import { SENSITIVE_LOG_FIELDS, isBulkDeleteLogEntry, type LogCategory } from "@management-bot/shared";
import { and, desc, eq, inArray, lt, ne, notInArray, or, sql } from "drizzle-orm";
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
  /** これらのカテゴリは結果から除外する(categoryフィルタと併用可)。 */
  excludeCategories?: readonly LogCategory[];
  /** trueの場合、authorIsBot=trueの行を結果から除外する。 */
  excludeBotEvents?: boolean;
}

export interface ListLogEntriesResult {
  entries: ListedLogEntry[];
  nextCursor: string | null;
}

export interface ListedLogEntry {
  id: string;
  entry: LogEntry;
  collapsedEntries?: ListedLogEntry[];
}

const messageAction = sql<string>`${logEntries.payload}->>'action'`;
const messageId = sql<string>`${logEntries.payload}->>'messageId'`;

/** 主クエリの候補ごとにbulkDeleteを走査しないよう、対象メッセージIDを一度だけ取得する。 */
export async function listBulkDeletedMessageIds(db: Db, guildId: string): Promise<string[]> {
  const rows = await db
    .select({ payload: logEntries.payload })
    .from(logEntries)
    .where(and(eq(logEntries.guildId, guildId), eq(logEntries.category, "message"), eq(messageAction, "bulkDelete")));
  const messageIds = new Set<string>();
  for (const row of rows) {
    const entry = parseLogEntry(row.payload);
    if (!isBulkDeleteLogEntry(entry)) continue;
    for (const deletedMessage of entry.deletedMessages) {
      if (deletedMessage.messageId) messageIds.add(deletedMessage.messageId);
    }
  }
  return [...messageIds];
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
  const collapsedMessageIds = !input.category || input.category === "message" ? await listBulkDeletedMessageIds(db, input.guildId) : [];
  const conditions = [eq(logEntries.guildId, input.guildId)];
  if (collapsedMessageIds.length > 0) {
    conditions.push(
      or(
        ne(logEntries.category, "message"),
        ne(messageAction, "create"),
        sql`${messageId} IS NULL`,
        notInArray(messageId, collapsedMessageIds),
      )!,
    );
  }
  if (input.category) conditions.push(eq(logEntries.category, input.category));
  if (input.excludeCategories && input.excludeCategories.length > 0) {
    conditions.push(notInArray(logEntries.category, [...input.excludeCategories]));
  }
  if (input.excludeBotEvents) {
    conditions.push(eq(logEntries.authorIsBot, false));
  }
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

  const parsedPage = page.map((row) => ({ id: row.id, entry: parseLogEntry(row.payload) }));
  const deletedMessageIds = parsedPage.flatMap(({ entry }) =>
    isBulkDeleteLogEntry(entry)
      ? entry.deletedMessages.flatMap((deletedMessage) => (deletedMessage.messageId ? [deletedMessage.messageId] : []))
      : [],
  );
  const relatedRows =
    deletedMessageIds.length === 0
      ? []
      : await db
          .select({ id: logEntries.id, payload: logEntries.payload })
          .from(logEntries)
          .where(
            and(
              eq(logEntries.guildId, input.guildId),
              eq(logEntries.category, "message"),
              eq(messageAction, "create"),
              inArray(messageId, deletedMessageIds),
              ...(input.excludeBotEvents ? [eq(logEntries.authorIsBot, false)] : []),
            ),
          );
  const relatedByMessageId = new Map<string, ListedLogEntry>();
  for (const row of relatedRows) {
    const entry = parseLogEntry(row.payload);
    if (entry.category === "message" && entry.action === "create" && entry.messageId) {
      relatedByMessageId.set(entry.messageId, { id: row.id, entry });
    }
  }

  return {
    entries: parsedPage.map((parent) => {
      if (!isBulkDeleteLogEntry(parent.entry)) return parent;
      const collapsedEntries = parent.entry.deletedMessages.flatMap((deletedMessage) => {
        const related = deletedMessage.messageId ? relatedByMessageId.get(deletedMessage.messageId) : undefined;
        return related ? [related] : [];
      });
      return collapsedEntries.length > 0 ? { ...parent, collapsedEntries } : parent;
    }),
    nextCursor:
      hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
  };
}

/**
 * VIEW_LOGS_RAWを持たない閲覧者向けにマスクするフィールド名をカテゴリごとに列挙したもの。
 * Record<LogCategory, ...>にすることで、カテゴリ追加時にここへの追記漏れを型チェックで検知できる。
 * voiceのchanges(selfMute等のフラグon/off)は本文相当の生データを含まないため対象外。
 */
/**
 * VIEW_LOGS_RAWを持たない閲覧者向けに、メッセージ本文など生データを含むフィールドを取り除く。
 * VIEW_LOGSのみでは要約(誰が・いつ・何をしたか)のみ見える想定。
 * マスク対象フィールドはLogEntryのzodスキーマの`.meta({ sensitive: true })`から導出する
 * (SENSITIVE_LOG_FIELDS、issue #219)。従来はここに手動列挙テーブルを持っており、
 * スキーマに新しい生データフィールドが増えた際の追記漏れが実際にバグを起こしていた。
 */
export function maskSensitiveFields(entry: LogEntry): LogEntry {
  const fields = SENSITIVE_LOG_FIELDS[entry.category];
  if (fields.length === 0) return entry;
  const masked = { ...entry } as Record<string, unknown>;
  let changed = false;
  for (const field of fields) {
    if (masked[field] !== undefined) {
      masked[field] = undefined;
      changed = true;
    }
  }
  return changed ? (masked as LogEntry) : entry;
}
