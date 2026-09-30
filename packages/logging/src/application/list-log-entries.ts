import type { Db } from "@management-bot/db";
import { logEntries } from "@management-bot/db";
import { SENSITIVE_LOG_FIELDS, isBulkDeleteLogEntry, type LogCategory } from "@management-bot/shared";
import { and, count, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { parseLogEntry, type LogEntry } from "../domain/index.js";

export interface ListLogEntriesInput {
  guildId: string;
  /** 指定時はこれらのカテゴリのみ返す(未指定・空配列は全カテゴリ)。 */
  categories?: readonly LogCategory[];
  limit: number;
  /** 先頭から読み飛ばす件数(ページ番号×limit)。 */
  offset?: number;
  /** これらのカテゴリは結果から除外する(categoriesフィルタと併用可)。 */
  excludeCategories?: readonly LogCategory[];
  /** trueの場合、authorIsBot=trueの行を結果から除外する。 */
  excludeBotEvents?: boolean;
}

export interface ListLogEntriesResult {
  entries: ListedLogEntry[];
  /** フィルタ条件に一致する総件数。総ページ数の算出に使う。 */
  totalCount: number;
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
 * offsetベースのページネーション。任意のページへ移動でき総ページ数も出せるよう、総件数も返す。
 * (createdAt, id)で一意に順序付けるため、同一createdAtでもページ境界の順序は安定する。
 */
export async function listLogEntries(
  db: Db,
  input: ListLogEntriesInput,
): Promise<ListLogEntriesResult> {
  const conditions = [eq(logEntries.guildId, input.guildId), isNotCollapsedMessageCreate(input.guildId)];
  const categories = input.categories && input.categories.length > 0 ? input.categories : undefined;
  // メッセージを含みモデレーションを含まない絞り込みでは親ケースが表示されないため、一括削除を通常どおり表示する。
  const parentCaseHidden = categories !== undefined && categories.includes("message") && !categories.includes("moderationCase");
  if (!parentCaseHidden) conditions.push(isNotCollapsedModerationBulkDelete());
  if (categories) conditions.push(inArray(logEntries.category, [...categories]));
  if (input.excludeCategories && input.excludeCategories.length > 0) {
    conditions.push(notInArray(logEntries.category, [...input.excludeCategories]));
  }
  if (input.excludeBotEvents) {
    conditions.push(eq(logEntries.authorIsBot, false));
  }
  const where = and(...conditions);
  const [page, [countRow]] = await Promise.all([
    db
      .select({ id: logEntries.id, payload: logEntries.payload })
      .from(logEntries)
      .where(where)
      .orderBy(desc(logEntries.createdAt), desc(logEntries.id))
      .limit(input.limit)
      .offset(input.offset ?? 0),
    db.select({ count: count() }).from(logEntries).where(where),
  ]);

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
    totalCount: countRow?.count ?? 0,
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
