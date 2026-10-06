import type { Db } from "@management-bot/db";
import { scheduledPosts, withResourceLock } from "@management-bot/db";
import { SCHEDULED_POST_CONTENT_MAX } from "@management-bot/shared";
import { and, count, desc, eq, gt, asc } from "drizzle-orm";
import { MIN_LEAD_MS, checkLimits, type LimitError } from "../domain/index.js";

export type ScheduledPostRow = typeof scheduledPosts.$inferSelect;

/** 本文は1〜2000文字(Unicodeコードポイント数。DBのchar_lengthと同じ数え方)。 */
export function isValidContent(content: string): boolean {
  const length = [...content].length;
  return length >= 1 && length <= SCHEDULED_POST_CONTENT_MAX && content.trim() !== "";
}

/** ギルド単位の上限チェック+INSERTを直列化するadvisory lockのキー。 */
export const CREATE_LOCK_KEY_PREFIX = "scheduled-post:create:";

export interface CreateScheduledPostInput {
  guildId: string;
  channelId: string;
  authorId: string;
  content: string;
  scheduledAt: Date;
  now: Date;
}

export type CreateScheduledPostResult =
  | { ok: true; post: ScheduledPostRow }
  | { ok: false; error: LimitError | "invalid_content" };

/**
 * 予約を登録する。上限(1人10件・1ギルド100件、pendingのみ)の判定とINSERTは、ギルド単位の
 * advisory lockで直列化し、同時登録で上限を超えないようにする。
 * (時刻の検証=過去・1分以内・半年超は呼び出し側でdomainのvalidateScheduledAtを通す)
 */
export async function createScheduledPost(
  db: Db,
  input: CreateScheduledPostInput,
  lock: typeof withResourceLock = withResourceLock,
): Promise<CreateScheduledPostResult> {
  if (!isValidContent(input.content)) return { ok: false, error: "invalid_content" };
  return lock(db, `${CREATE_LOCK_KEY_PREFIX}${input.guildId}`, async (lockedDb) => {
    const [guildCount] = await lockedDb
      .select({ value: count() })
      .from(scheduledPosts)
      .where(and(eq(scheduledPosts.guildId, input.guildId), eq(scheduledPosts.status, "pending")));
    const [userCount] = await lockedDb
      .select({ value: count() })
      .from(scheduledPosts)
      .where(
        and(
          eq(scheduledPosts.guildId, input.guildId),
          eq(scheduledPosts.authorId, input.authorId),
          eq(scheduledPosts.status, "pending"),
        ),
      );
    const limitError = checkLimits({ userPending: userCount?.value ?? 0, guildPending: guildCount?.value ?? 0 });
    if (limitError) return { ok: false, error: limitError };

    const [post] = await lockedDb
      .insert(scheduledPosts)
      .values({
        guildId: input.guildId,
        channelId: input.channelId,
        authorId: input.authorId,
        content: input.content,
        scheduledAt: input.scheduledAt,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning();
    if (!post) throw new Error("scheduled post insert returned no row");
    return { ok: true, post };
  });
}

export interface EditScheduledPostInput {
  id: string;
  authorId: string;
  content: string;
  scheduledAt: Date;
  now: Date;
}

export type EditScheduledPostResult =
  | { ok: true; before: ScheduledPostRow; after: ScheduledPostRow }
  | { ok: false; error: "invalid_content" | "not_found" | "too_late" | "not_pending" };

/**
 * 予約を編集する(本文と日時。投稿先は変更不可)。編集できるのは本人のpendingで、かつ
 * 現在の投稿予定時刻の1分前まで(投稿処理との競合防止)。状態の確認は条件付きUPDATEで行い、
 * 既にclaimされた予約を書き換えない。
 */
export async function editScheduledPost(db: Db, input: EditScheduledPostInput): Promise<EditScheduledPostResult> {
  if (!isValidContent(input.content)) return { ok: false, error: "invalid_content" };
  const cutoff = new Date(input.now.getTime() + MIN_LEAD_MS);

  const [before] = await db
    .select()
    .from(scheduledPosts)
    .where(
      and(eq(scheduledPosts.id, input.id), eq(scheduledPosts.authorId, input.authorId), eq(scheduledPosts.status, "pending")),
    );
  if (!before) return { ok: false, error: "not_found" };
  if (before.scheduledAt.getTime() <= cutoff.getTime()) return { ok: false, error: "too_late" };

  const [after] = await db
    .update(scheduledPosts)
    .set({ content: input.content, scheduledAt: input.scheduledAt, updatedAt: input.now })
    .where(
      and(
        eq(scheduledPosts.id, input.id),
        eq(scheduledPosts.authorId, input.authorId),
        eq(scheduledPosts.status, "pending"),
        gt(scheduledPosts.scheduledAt, cutoff),
      ),
    )
    .returning();
  if (!after) return { ok: false, error: "not_pending" };
  return { ok: true, before, after };
}

export interface CancelScheduledPostInput {
  id: string;
  /** author: 本人の取り消し(authorIdが一致する予約のみ)。admin: Dashboardからの取り消し(guildIdが一致する予約のみ)。 */
  by: "author" | "admin";
  guildId: string;
  /** by="author"のとき必須。 */
  authorId?: string;
  /** by="admin"のとき、取り消した管理者(DBに保存し、Botの後処理のログイベントで使う)。 */
  executor?: { id: string; name?: string };
  now: Date;
}

/** 取り消す。投稿処理が始まっていない(status='pending')間のみ成功し、成功時のみ更新後の行を返す。 */
export async function cancelScheduledPost(db: Db, input: CancelScheduledPostInput): Promise<ScheduledPostRow | null> {
  const conditions = [
    eq(scheduledPosts.id, input.id),
    eq(scheduledPosts.guildId, input.guildId),
    eq(scheduledPosts.status, "pending"),
  ];
  if (input.by === "author") {
    if (input.authorId === undefined) throw new Error("authorId is required for author cancellation");
    conditions.push(eq(scheduledPosts.authorId, input.authorId));
  }
  const [row] = await db
    .update(scheduledPosts)
    .set({
      status: "cancelled",
      cancelledBy: input.by,
      cancelledByUserId: input.by === "admin" ? (input.executor?.id ?? null) : null,
      cancelledByUserName: input.by === "admin" ? (input.executor?.name ?? null) : null,
      finishedAt: input.now,
      updatedAt: input.now,
    })
    .where(and(...conditions))
    .returning();
  return row ?? null;
}

export async function getScheduledPost(db: Db, id: string): Promise<ScheduledPostRow | null> {
  const [row] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, id));
  return row ?? null;
}

/** 自分の投稿待ちの予約(/schedule list)。 */
export async function listMyPendingPosts(db: Db, guildId: string, authorId: string): Promise<ScheduledPostRow[]> {
  return db
    .select()
    .from(scheduledPosts)
    .where(
      and(eq(scheduledPosts.guildId, guildId), eq(scheduledPosts.authorId, authorId), eq(scheduledPosts.status, "pending")),
    )
    .orderBy(asc(scheduledPosts.scheduledAt))
    .limit(25);
}

const GUILD_LIST_LIMIT = 300;

/** ギルド全体の予約(Dashboard)。保持期間(30日)内の全状態を、予定時刻の新しい順で返す。 */
export async function listGuildPosts(db: Db, guildId: string): Promise<ScheduledPostRow[]> {
  return db
    .select()
    .from(scheduledPosts)
    .where(eq(scheduledPosts.guildId, guildId))
    .orderBy(desc(scheduledPosts.scheduledAt))
    .limit(GUILD_LIST_LIMIT);
}
