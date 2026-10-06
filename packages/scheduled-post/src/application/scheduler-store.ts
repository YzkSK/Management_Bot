import type { Db } from "@management-bot/db";
import { scheduledPosts } from "@management-bot/db";
import type { ScheduledPostFailureReason } from "@management-bot/shared";
import { and, eq, inArray, isNull, lt, lte, asc } from "drizzle-orm";
import type { ScheduledPostRow } from "./posts.js";

/** 終了済み(posted/failed/cancelled)の予約を残す日数。記録はlogging機能側に残る。 */
export const RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;
const CLAIM_BATCH = 50;

/**
 * 時刻が来た予約を投稿処理中(posting)にclaimして返す。対象はpendingのみ。pending→postingは条件付きUPDATE
 * (`WHERE id=? AND status='pending'` RETURNING)で行い、同じ予約を2回claimしない。
 */
export async function claimDuePosts(db: Db, now: Date, limit = CLAIM_BATCH): Promise<ScheduledPostRow[]> {
  const candidates = await db
    .select({ id: scheduledPosts.id })
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.status, "pending"), lte(scheduledPosts.scheduledAt, now)))
    .orderBy(asc(scheduledPosts.scheduledAt))
    .limit(limit);
  if (candidates.length === 0) return [];

  const claimed: ScheduledPostRow[] = [];
  for (const { id } of candidates) {
    const [row] = await db
      .update(scheduledPosts)
      .set({ status: "posting", updatedAt: now })
      .where(and(eq(scheduledPosts.id, id), eq(scheduledPosts.status, "pending")))
      .returning();
    if (row) claimed.push(row);
  }
  return claimed;
}

/** posting→posted。claim済み(posting)の行のみ更新する。 */
export async function markPosted(db: Db, id: string, messageId: string, now: Date): Promise<ScheduledPostRow | null> {
  const [row] = await db
    .update(scheduledPosts)
    .set({ status: "posted", messageId, finishedAt: now, updatedAt: now })
    .where(and(eq(scheduledPosts.id, id), eq(scheduledPosts.status, "posting")))
    .returning();
  return row ?? null;
}

/** posting→failed。claim済み(posting)の行のみ更新する。 */
export async function markFailed(
  db: Db,
  id: string,
  reason: ScheduledPostFailureReason,
  now: Date,
): Promise<ScheduledPostRow | null> {
  const [row] = await db
    .update(scheduledPosts)
    .set({ status: "failed", failureReason: reason, finishedAt: now, updatedAt: now })
    .where(and(eq(scheduledPosts.id, id), eq(scheduledPosts.status, "posting")))
    .returning();
  return row ?? null;
}

/** posting状態がこれより長く続いたら投稿途中で落ちたとみなす(1件の投稿処理は通常数秒で終わる)。 */
export const STUCK_POSTING_MS = 5 * 60 * 1000;

/**
 * postingのまま STUCK_POSTING_MS 以上残った予約(投稿途中でBotが落ちた)は、送れたか分からないため
 * 再送せず failed/unknown_result にして返す(重複投稿より投稿漏れを選ぶ)。
 * 経過時間で絞るのは、デプロイ時に旧プロセスが処理中の予約を新プロセスが誤って失敗扱いにしないため。
 */
export async function recoverStuckPosting(db: Db, now: Date): Promise<ScheduledPostRow[]> {
  const threshold = new Date(now.getTime() - STUCK_POSTING_MS);
  const stuck = await db
    .select({ id: scheduledPosts.id })
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.status, "posting"), lt(scheduledPosts.updatedAt, threshold)));
  const recovered: ScheduledPostRow[] = [];
  for (const { id } of stuck) {
    const row = await markFailed(db, id, "unknown_result", now);
    if (row) recovered.push(row);
  }
  return recovered;
}

/**
 * 管理者取り消しの後処理(DM・ログ発行)を1件claimする。`cancel_notified_at IS NULL`の条件付きUPDATEで、
 * 複数Botプロセス・pg_notifyとtick回収が競合しても行を得るのは1プロセスだけ。claim後のクラッシュでは
 * 再送しない(重複より取りこぼしを選ぶ)。
 */
export async function claimAdminCancelNotice(
  db: Db,
  id: string,
  now: Date,
  guildId?: string,
): Promise<ScheduledPostRow | null> {
  const conditions = [
    eq(scheduledPosts.id, id),
    eq(scheduledPosts.status, "cancelled"),
    eq(scheduledPosts.cancelledBy, "admin"),
    isNull(scheduledPosts.cancelNotifiedAt),
  ];
  if (guildId !== undefined) conditions.push(eq(scheduledPosts.guildId, guildId));
  const [row] = await db
    .update(scheduledPosts)
    .set({ cancelNotifiedAt: now })
    .where(and(...conditions))
    .returning();
  return row ?? null;
}

/** 未処理の管理者取り消し(通知の取りこぼし・Bot停止中の取り消し)を最大limit件claimして返す。 */
export async function claimPendingAdminCancelNotices(
  db: Db,
  now: Date,
  limit = CLAIM_BATCH,
): Promise<ScheduledPostRow[]> {
  const candidates = await db
    .select({ id: scheduledPosts.id })
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.status, "cancelled"),
        eq(scheduledPosts.cancelledBy, "admin"),
        isNull(scheduledPosts.cancelNotifiedAt),
      ),
    )
    .orderBy(asc(scheduledPosts.finishedAt))
    .limit(limit);
  const claimed: ScheduledPostRow[] = [];
  for (const { id } of candidates) {
    const row = await claimAdminCancelNotice(db, id, now);
    if (row) claimed.push(row);
  }
  return claimed;
}

/** 終了後RETENTION_DAYS日を過ぎた予約を削除する。削除件数を返す。 */
export async function purgeFinishedPosts(db: Db, now: Date): Promise<number> {
  const threshold = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
  const rows = await db
    .delete(scheduledPosts)
    .where(
      and(inArray(scheduledPosts.status, ["posted", "failed", "cancelled"]), lt(scheduledPosts.finishedAt, threshold)),
    )
    .returning({ id: scheduledPosts.id });
  return rows.length;
}
