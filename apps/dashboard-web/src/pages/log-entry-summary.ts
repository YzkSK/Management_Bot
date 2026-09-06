import { getLogEntrySubjectId, getLogEntrySubjectField, type LogEntry } from "@management-bot/shared";

export interface LogEntryFieldChange {
  before: string | number | boolean;
  after: string | number | boolean;
}

export interface LogEntrySummary {
  category: string;
  createdAt: string;
  /** 実行者(executorId、監査ログ相関で判明した場合)またはカテゴリ固有の主体(authorId/userId等)。どちらもなければnull。 */
  subjectId: string | null;
  /** 監査ログ相関で判明した実行者ID。未判明ならnull。 */
  executorId: string | null;
  /** カテゴリ固有の主体(投稿者/対象ユーザー等、authorId/userId/targetUserId)。存在しないカテゴリではnull。 */
  categorySubjectId: string | null;
  action: string | null;
  /** メッセージ本文等、そのまま読める形で表示したいテキスト。 */
  content: string | null;
  /** action=updateの編集前本文(message)。移行前の既存ログや対象外カテゴリではnull。 */
  previousContent: string | null;
  /** action=updateのフィールドごとの変更前後(role)。対象外カテゴリ・差分なしではnull。 */
  changes: Record<string, LogEntryFieldChange> | null;
  /** 上記以外のcategory固有フィールド。一覧では隠し、詳細展開時のみJSONで描画する。 */
  details: Record<string, unknown>;
}

const BASE_FIELDS = new Set(["category", "createdAt", "executorId", "guildId"]);

/** カテゴリごとに形の異なるLogEntryを、一覧表示用の共通形式に変換する。 */
export function summarizeLogEntry(entry: LogEntry): LogEntrySummary {
  const executorId = "executorId" in entry ? entry.executorId : undefined;
  const categorySubjectId = getLogEntrySubjectId(entry);
  const subjectId = executorId ?? categorySubjectId;
  const subjectField = executorId !== undefined ? "executorId" : getLogEntrySubjectField(entry);
  const details: Record<string, unknown> = {};
  let action: string | null = null;
  let content: string | null = null;
  let previousContent: string | null = null;
  let changes: Record<string, LogEntryFieldChange> | null = null;
  for (const [key, value] of Object.entries(entry)) {
    if (key === "action" && typeof value === "string") {
      action = value;
      continue;
    }
    if (key === "content" && typeof value === "string") {
      content = value;
      continue;
    }
    if (key === "previousContent" && typeof value === "string") {
      previousContent = value;
      continue;
    }
    if (key === "changes" && typeof value === "object" && value !== null) {
      changes = value as Record<string, LogEntryFieldChange>;
      continue;
    }
    if (!BASE_FIELDS.has(key) && key !== subjectField) {
      details[key] = value;
    }
  }
  return {
    category: entry.category,
    createdAt: entry.createdAt,
    subjectId: subjectId ?? null,
    executorId: executorId ?? null,
    categorySubjectId: categorySubjectId ?? null,
    action,
    content,
    previousContent,
    changes,
    details,
  };
}
