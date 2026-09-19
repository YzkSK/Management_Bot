import type { Db } from "@management-bot/db";
import { logEntries } from "@management-bot/db";
import { SENSITIVE_LOG_FIELDS, isBulkDeleteLogEntry, type LogCategory } from "@management-bot/shared";
import { and, desc, eq, inArray, lt, notInArray, or, sql } from "drizzle-orm";
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
const moderationCaseId = sql<string>`${logEntries.payload}->>'moderationCaseId'`;

/** 主クエリの候補ごとにbulkDeleteを走査しないよう、対象メッセージIDを一度だけ取得する。 */
/**
 * 対象IDをアプリケーション側の配列に展開せず、非相関の副問合せで通常の投稿ログから除外する。
 * bulkDeleteの履歴数が増えてもPostgreSQLのbind parameter上限を超えないようにする。
 */
function isNotCollapsedMessageCreate(guildId: string) {
  return sql`
    (
      ${logEntries.category} <> 'message'
      OR ${messageAction} <> 'create'
      OR ${messageId} IS NULL
      OR ${messageId} NOT IN (
        SELECT deleted_message ->> 'messageId'
        FROM "log_entries" AS "bulk_log_entries"
        CROSS JOIN LATERAL jsonb_array_elements("bulk_log_entries"."payload" -> 'deletedMessages') AS deleted_message
        WHERE "bulk_log_entries"."guild_id" = ${guildId}
          AND "bulk_log_entries"."category" = 'message'
          AND "bulk_log_entries"."payload" ->> 'action' = 'bulkDelete'
          AND deleted_message ->> 'messageId' IS NOT NULL
      )
    )
  `;
}

/** モデレーションケースへ集約される一括削除は、通常の一覧では親ケース配下でのみ表示する。 */
function isNotCollapsedModerationBulkDelete() {
  return sql`
    (
      ${logEntries.category} <> 'message'
      OR ${messageAction} <> 'bulkDelete'
      OR ${moderationCaseId} IS NULL
    )
  `;
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
  const conditions = [eq(logEntries.guildId, input.guildId), isNotCollapsedMessageCreate(input.guildId)];
  // メッセージだけに絞った画面では親ケースが表示されないため、一括削除を通常どおり表示する。
  if (input.category !== "message") conditions.push(isNotCollapsedModerationBulkDelete());
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
  const moderationCaseIds = parsedPage.flatMap(({ entry }) =>
    entry.category === "moderationCase" ? [entry.caseId] : [],
  );
  const moderationBulkRows =
    moderationCaseIds.length === 0
      ? []
      : await db
          .select({ id: logEntries.id, payload: logEntries.payload })
          .from(logEntries)
          .where(
            and(
              eq(logEntries.guildId, input.guildId),
              eq(logEntries.category, "message"),
              eq(messageAction, "bulkDelete"),
              inArray(moderationCaseId, moderationCaseIds),
            ),
          );
  const moderationBulks = moderationBulkRows.flatMap((row) => {
    const entry = parseLogEntry(row.payload);
    return isBulkDeleteLogEntry(entry) ? [{ id: row.id, entry }] : [];
  });
  const visibleBulks = parsedPage.filter(({ entry }) => isBulkDeleteLogEntry(entry));
  const allBulks = [...visibleBulks, ...moderationBulks];
  const deletedMessageIds = allBulks.flatMap(({ entry }) =>
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

  const withDeletedMessageEntries = (parent: ListedLogEntry): ListedLogEntry => {
    if (!isBulkDeleteLogEntry(parent.entry)) return parent;
    const collapsedEntries = parent.entry.deletedMessages.flatMap((deletedMessage) => {
        const related = deletedMessage.messageId ? relatedByMessageId.get(deletedMessage.messageId) : undefined;
        return related ? [related] : [];
    });
    return collapsedEntries.length > 0 ? { ...parent, collapsedEntries } : parent;
  };
  const moderatedBulksByCaseId = new Map<string, ListedLogEntry[]>();
  for (const bulk of moderationBulks) {
    if (!bulk.entry.moderationCaseId) continue;
    const current = moderatedBulksByCaseId.get(bulk.entry.moderationCaseId) ?? [];
    current.push(withDeletedMessageEntries(bulk));
    moderatedBulksByCaseId.set(bulk.entry.moderationCaseId, current);
  }

  return {
    entries: parsedPage.map((parent) => {
      if (parent.entry.category === "moderationCase") {
        const collapsedEntries = moderatedBulksByCaseId.get(parent.entry.caseId);
        return collapsedEntries && collapsedEntries.length > 0 ? { ...parent, collapsedEntries } : parent;
      }
      return withDeletedMessageEntries(parent);
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
