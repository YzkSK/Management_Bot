import { LOG_CATEGORIES, type LogCategory } from "@management-bot/shared";

/**
 * カテゴリ別設定テーブル(log_retention_settings/log_channel_settings)の行を、
 * LOG_CATEGORIES全件分の設定にそろえる。行のないカテゴリはrowをundefinedとして
 * toSettingに渡すので、呼び出し側で既定値を補う。
 */
export function mapAllLogCategories<Row extends { category: string }, Setting>(
  rows: readonly Row[],
  toSetting: (category: LogCategory, row: Row | undefined) => Setting,
): Setting[] {
  const byCategory = new Map(rows.map((row) => [row.category, row]));
  return LOG_CATEGORIES.map((category) => toSetting(category, byCategory.get(category)));
}

/** 全カテゴリに同じ値を一括upsertするための、LOG_CATEGORIES全件分のinsert行を作る。 */
export function valuesForAllLogCategories<Values extends object>(
  guildId: string,
  values: Values,
): ({ guildId: string; category: LogCategory } & Values)[] {
  return LOG_CATEGORIES.map((category) => ({ guildId, category, ...values }));
}
