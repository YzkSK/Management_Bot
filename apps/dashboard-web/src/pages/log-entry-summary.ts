import { getLogEntrySubjectId, getLogEntrySubjectField, type LogEntry } from "@management-bot/shared";

export interface LogEntrySummary {
  category: string;
  createdAt: string;
  /** 実行者(executorId、監査ログ相関で判明した場合)またはカテゴリ固有の主体(authorId/userId等)。どちらもなければnull。 */
  subjectId: string | null;
  action: string | null;
  /** メッセージ本文等、そのまま読める形で表示したいテキスト。 */
  content: string | null;
  /** 上記以外のcategory固有フィールド。一覧では隠し、詳細展開時のみJSONで描画する。 */
  details: Record<string, unknown>;
}

const BASE_FIELDS = new Set(["category", "createdAt", "executorId", "guildId"]);

/** カテゴリごとに形の異なるLogEntryを、一覧表示用の共通形式に変換する。 */
export function summarizeLogEntry(entry: LogEntry): LogEntrySummary {
  const executorId = "executorId" in entry ? entry.executorId : undefined;
  const subjectId = executorId ?? getLogEntrySubjectId(entry);
  const subjectField = executorId !== undefined ? "executorId" : getLogEntrySubjectField(entry);
  const details: Record<string, unknown> = {};
  let action: string | null = null;
  let content: string | null = null;
  for (const [key, value] of Object.entries(entry)) {
    if (key === "action" && typeof value === "string") {
      action = value;
      continue;
    }
    if (key === "content" && typeof value === "string") {
      content = value;
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
    action,
    content,
    details,
  };
}
