import type { Db } from "@management-bot/db";
import { logEntries, logRetentionSettings } from "@management-bot/db";
import { and, eq, lte, sql } from "drizzle-orm";

export interface PurgeExpiredLogsResult {
  guildId: string;
  category: string;
  deletedCount: number;
}

/**
 * guild×categoryごとに設定されたretentionDaysを超えたlog_entriesを削除する。
 * retentionDays=0(無期限保存)の設定、および設定自体が存在しないguild×category
 * は対象外(削除しない)。判定条件はdomain層のisExpired()と同じ意味論
 * (now - createdAt >= retentionDays日、境界含む)をSQLで表現している
 * (retention.test.tsの境界値テストと本ファイルの結合テストで一致を保証)。
 * ログ件数が多くなり得るためSQL側のDELETEで完結させ、全件をアプリ側に
 * ロードしない。
 */
export async function purgeExpiredLogs(db: Db, now: Date = new Date()): Promise<PurgeExpiredLogsResult[]> {
  const settings = await db
    .select({
      guildId: logRetentionSettings.guildId,
      category: logRetentionSettings.category,
      retentionDays: logRetentionSettings.retentionDays,
    })
    .from(logRetentionSettings)
    .where(sql`${logRetentionSettings.retentionDays} > 0`);

  const results: PurgeExpiredLogsResult[] = [];
  for (const setting of settings) {
    const cutoff = new Date(now.getTime() - setting.retentionDays * 24 * 60 * 60 * 1000);
    const deleted = await db
      .delete(logEntries)
      .where(
        and(
          eq(logEntries.guildId, setting.guildId),
          eq(logEntries.category, setting.category),
          lte(logEntries.createdAt, cutoff),
        ),
      )
      .returning({ id: logEntries.id });

    if (deleted.length > 0) {
      results.push({ guildId: setting.guildId, category: setting.category, deletedCount: deleted.length });
    }
  }
  return results;
}
