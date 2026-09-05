import type { Db } from "@management-bot/db";
import { logRetentionSettings } from "@management-bot/db";
import { LOG_CATEGORIES, type LogCategory } from "@management-bot/shared";
import { eq } from "drizzle-orm";

export interface RetentionSetting {
  category: LogCategory;
  /** 保存期間(日数)。0は無期限保存(設定行が無い場合も同じ意味として0で返す)。 */
  retentionDays: number;
}

/** 全カテゴリ分の保持期間設定を返す。未設定のカテゴリはretentionDays=0(無期限)として補完する。 */
export async function listRetentionSettings(db: Db, guildId: string): Promise<RetentionSetting[]> {
  const rows = await db
    .select({ category: logRetentionSettings.category, retentionDays: logRetentionSettings.retentionDays })
    .from(logRetentionSettings)
    .where(eq(logRetentionSettings.guildId, guildId));

  const byCategory = new Map(rows.map((row) => [row.category, row.retentionDays]));

  return LOG_CATEGORIES.map((category) => ({
    category,
    retentionDays: byCategory.get(category) ?? 0,
  }));
}

export async function setRetentionSetting(
  db: Db,
  guildId: string,
  category: LogCategory,
  retentionDays: number,
): Promise<void> {
  await db
    .insert(logRetentionSettings)
    .values({ guildId, category, retentionDays })
    .onConflictDoUpdate({
      target: [logRetentionSettings.guildId, logRetentionSettings.category],
      set: { retentionDays },
    });
}

/**
 * 全カテゴリの保持期間を一括で同じ値に設定する(カテゴリごとの個別設定は上書きされる)。
 * ponytail: 現時点のLOG_CATEGORIESへ実際に行を書き込むだけで、「ギルド単位の既定値」を
 * 別途保持しているわけではない。将来LOG_CATEGORIESにカテゴリを追加した場合、既存ギルドの
 * 新カテゴリはretentionDays=0(無期限)から始まり、過去の一括設定値を継承しない。
 * 継承が必要になったらguild単位のデフォルト値テーブルを別途設け、カテゴリ別設定を
 * そのoverrideとして扱う設計に切り替えること。
 */
export async function setRetentionSettingForAllCategories(
  db: Db,
  guildId: string,
  retentionDays: number,
): Promise<void> {
  await db
    .insert(logRetentionSettings)
    .values(LOG_CATEGORIES.map((category) => ({ guildId, category, retentionDays })))
    .onConflictDoUpdate({
      target: [logRetentionSettings.guildId, logRetentionSettings.category],
      set: { retentionDays },
    });
}
