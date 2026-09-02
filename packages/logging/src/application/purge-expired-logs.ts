import { logEntries, logRetentionSettings } from "@management-bot/db";
import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { TablesRelationalConfig } from "drizzle-orm";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";

export interface PurgeExpiredLogsResult {
  guildId: string;
  category: string;
  deletedCount: number;
}

type PurgeRow = Record<string, unknown> & {
  guild_id: string;
  category: string;
  deleted_count: number;
};

/**
 * guild×categoryごとに設定されたretentionDaysを超えたlog_entriesを削除する。
 * retentionDays=0(無期限保存)の設定、および設定自体が存在しないguild×category
 * は対象外(削除しない)。判定条件はdomain層のisExpired()と同じ意味論
 * (now - createdAt >= retentionDays日、境界含む)をSQLで表現している
 * (retention.test.tsの境界値テストと本ファイルの結合テストで一致を保証)。
 *
 * log_retention_settingsとJOINした1本のDELETEで全guild×category分を一括削除する
 * (guild数ぶん逐次DELETEするとレイテンシがguild数に比例して伸びるため)。
 * RETURNING句のguild_id/categoryをCTEで集計し、行本体(payload等)をアプリ側へ
 * 転送しないことで大量削除時のメモリ・通信量増大も避ける。
 *
 * dbはPgDatabase(通常のDbインスタンス)・PgTransaction(db.transaction内のtx、
 * PgDatabaseを継承)のどちらでも受け取れるようジェネリクスで受ける。DBレベルの
 * advisory lockをトランザクション内で取得してから呼び出すユースケース
 * (apps/logging-retention)のためにtx呼び出しにも対応するため。
 */
export async function purgeExpiredLogs<
  TFullSchema extends Record<string, unknown>,
  TSchema extends TablesRelationalConfig,
>(
  db: PgDatabase<PostgresJsQueryResultHKT, TFullSchema, TSchema>,
  now: Date = new Date(),
): Promise<PurgeExpiredLogsResult[]> {
  const result: PurgeRow[] = await db.execute<PurgeRow>(sql`
    WITH deleted AS (
      DELETE FROM ${logEntries}
      USING ${logRetentionSettings}
      WHERE ${logEntries.guildId} = ${logRetentionSettings.guildId}
        AND ${logEntries.category} = ${logRetentionSettings.category}
        AND ${logRetentionSettings.retentionDays} > 0
        AND ${logEntries.createdAt} <= ${now.toISOString()}::timestamptz - (${logRetentionSettings.retentionDays} || ' days')::interval
      RETURNING ${logEntries.guildId} AS guild_id, ${logEntries.category} AS category
    )
    SELECT guild_id, category, count(*)::int AS deleted_count
    FROM deleted
    GROUP BY guild_id, category
  `);

  return result.map((row) => ({
    guildId: row.guild_id,
    category: row.category,
    deletedCount: row.deleted_count,
  }));
}
