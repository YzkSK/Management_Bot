import { and, eq, gt, sql, type TablesRelationalConfig } from "drizzle-orm";
import type { Db } from "@management-bot/db";
import { moderationEscalationState } from "@management-bot/db";
import type { ModerationViolationType } from "@management-bot/shared";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";

/**
 * (guildId, userId, violationType)のstrikeCountをインクリメントし、更新後の値を返す。
 * lastViolationAtもupsertのたびに更新する(初回違反時刻のまま固定されないようにする)。
 */
export async function incrementStrike(
  db: Db,
  guildId: string,
  userId: string,
  violationType: ModerationViolationType,
): Promise<number> {
  const [row] = await db
    .insert(moderationEscalationState)
    .values({ guildId, userId, violationType, strikeCount: 1 })
    .onConflictDoUpdate({
      target: [
        moderationEscalationState.guildId,
        moderationEscalationState.userId,
        moderationEscalationState.violationType,
      ],
      set: {
        strikeCount: sql`${moderationEscalationState.strikeCount} + 1`,
        lastViolationAt: sql`now()`,
      },
    })
    .returning({ strikeCount: moderationEscalationState.strikeCount });

  if (!row) throw new Error("incrementStrike: upsert returned no row");
  return row.strikeCount;
}

export interface StrikeRow {
  userId: string;
  violationType: ModerationViolationType;
  strikeCount: number;
  lastViolationAt: Date;
}

const LIST_STRIKES_PAGE_SIZE = 50;

export interface StrikePage {
  rows: StrikeRow[];
  /** 次ページがある場合のカーソル(このページ最終行のuserId)。ないなら undefined。 */
  nextAfter: string | undefined;
}

/**
 * guild内のストライク行をuserId昇順でページングして返す(Dashboard表示用)。
 * 大規模guildでの一括取得によるクエリ・レスポンス肥大化を避けるため、
 * (userId, violationType)のkeyset paginationで最大LIST_STRIKES_PAGE_SIZE件ずつ返す。
 */
export async function listStrikes(db: Db, guildId: string, after?: string): Promise<StrikePage> {
  const rows = await db
    .select({
      userId: moderationEscalationState.userId,
      violationType: moderationEscalationState.violationType,
      strikeCount: moderationEscalationState.strikeCount,
      lastViolationAt: moderationEscalationState.lastViolationAt,
    })
    .from(moderationEscalationState)
    .where(
      and(
        eq(moderationEscalationState.guildId, guildId),
        after ? gt(moderationEscalationState.userId, after) : undefined,
      ),
    )
    .orderBy(moderationEscalationState.userId, moderationEscalationState.violationType)
    .limit(LIST_STRIKES_PAGE_SIZE + 1);

  const hasNextPage = rows.length > LIST_STRIKES_PAGE_SIZE;
  const page = hasNextPage ? rows.slice(0, LIST_STRIKES_PAGE_SIZE) : rows;
  return { rows: page, nextAfter: hasNextPage ? page[page.length - 1]?.userId : undefined };
}

/** (guildId, userId, violationType)のストライクをリセットする(該当行を削除)。 */
export async function resetStrike(
  db: Db,
  guildId: string,
  userId: string,
  violationType: ModerationViolationType,
): Promise<void> {
  await db
    .delete(moderationEscalationState)
    .where(
      and(
        eq(moderationEscalationState.guildId, guildId),
        eq(moderationEscalationState.userId, userId),
        eq(moderationEscalationState.violationType, violationType),
      ),
    );
}

/**
 * (guildId, userId)の全violationTypeのstrikeCountを合算して返す。エスカレーション判定
 * (decideEscalationAction)は違反種別を跨いだこの合計値に対して行う(統一ストライク
 * カウンター、#311)。内訳は合計値とは別カラム/テーブルにキャッシュせず、都度SUMする
 * (二重管理による不整合を避けるため)。
 */
export async function getTotalStrikeCount(db: Db, guildId: string, userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${moderationEscalationState.strikeCount}), 0)` })
    .from(moderationEscalationState)
    .where(and(eq(moderationEscalationState.guildId, guildId), eq(moderationEscalationState.userId, userId)));

  return Number(row?.total ?? 0);
}

/** (guildId, userId)の全violationType行を削除する(Dashboardの一括リセット用)。 */
export async function resetAllStrikes(db: Db, guildId: string, userId: string): Promise<void> {
  await db
    .delete(moderationEscalationState)
    .where(and(eq(moderationEscalationState.guildId, guildId), eq(moderationEscalationState.userId, userId)));
}

/**
 * lastViolationAtからbaseHours×strikeCount時間が経過した行のstrikeCountを1減らす
 * (strikeCountが多いほど次の減少までの時間が長くなる)。lastViolationAtは減少のたびに
 * 現在時刻へ更新し、次の減少判定の起点とする。0になった行は削除する。
 *
 * purgeExpiredLogs(@management-bot/logging)と同じ理由で、PgDatabase(通常のDb)・
 * PgTransaction(db.transaction内のtx)のどちらでも受け取れるようジェネリクスで受ける
 * (apps/moderation-decayでadvisory lock取得後にtx経由で呼び出すため)。
 */
export async function decayStrikes<
  TFullSchema extends Record<string, unknown>,
  TSchema extends TablesRelationalConfig,
>(db: PgDatabase<PostgresJsQueryResultHKT, TFullSchema, TSchema>, baseHours: number): Promise<void> {
  const threshold = sql`${moderationEscalationState.lastViolationAt} + (${moderationEscalationState.strikeCount} * ${baseHours} * interval '1 hour')`;

  await db
    .update(moderationEscalationState)
    .set({
      strikeCount: sql`${moderationEscalationState.strikeCount} - 1`,
      lastViolationAt: sql`now()`,
    })
    .where(sql`now() >= ${threshold}`);

  await db.delete(moderationEscalationState).where(eq(moderationEscalationState.strikeCount, 0));
}
