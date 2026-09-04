export interface LogEntrySummary {
  category: string;
  createdAt: string;
  executorId: string | null;
  action: string | null;
  /** category固有フィールド(汎用表示用にJSONとして描画する)。 */
  details: Record<string, unknown>;
}

const BASE_FIELDS = new Set(["category", "createdAt", "executorId", "guildId"]);

/** カテゴリごとに形の異なるLogEntryを、一覧表示用の共通形式に変換する。 */
export function summarizeLogEntry<T extends { category: string; createdAt: string; executorId?: string }>(
  entry: T,
): LogEntrySummary {
  const details: Record<string, unknown> = {};
  let action: string | null = null;
  for (const [key, value] of Object.entries(entry)) {
    if (key === "action" && typeof value === "string") {
      action = value;
      continue;
    }
    if (!BASE_FIELDS.has(key)) {
      details[key] = value;
    }
  }
  return {
    category: entry.category,
    createdAt: entry.createdAt,
    executorId: entry.executorId ?? null,
    action,
    details,
  };
}
