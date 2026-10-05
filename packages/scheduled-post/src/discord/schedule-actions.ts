import type { Db } from "@management-bot/db";
import {
  cancelScheduledPost,
  createScheduledPost,
  editScheduledPost,
  type CancelScheduledPostInput,
  type CreateScheduledPostResult,
  type EditScheduledPostResult,
  type ScheduledPostRow,
} from "../application/index.js";
import type { PublishScheduledPostEvent } from "./events.js";

export interface ActionDeps {
  db: Db;
  publish: PublishScheduledPostEvent;
  now?: () => Date;
}

interface Names {
  channelName?: string;
  authorName?: string;
}

function eventBase(post: ScheduledPostRow, names: Names, now: Date) {
  return {
    type: "scheduled-post.event.recorded" as const,
    guildId: post.guildId,
    postId: post.id,
    channelId: post.channelId,
    channelName: names.channelName,
    authorId: post.authorId,
    authorName: names.authorName,
    createdAt: now.toISOString(),
  };
}

const clock = (deps: ActionDeps): Date => (deps.now ?? (() => new Date()))();

/** 登録して、成功時はログイベント(created)を発行する。 */
export async function createPostAction(
  deps: ActionDeps,
  input: { guildId: string; channelId: string; authorId: string; content: string; scheduledAt: Date } & Names,
): Promise<CreateScheduledPostResult> {
  const now = clock(deps);
  const result = await createScheduledPost(deps.db, { ...input, now });
  if (result.ok) {
    await deps.publish({
      ...eventBase(result.post, input, now),
      action: "created",
      content: result.post.content,
      scheduledAt: result.post.scheduledAt.toISOString(),
    });
  }
  return result;
}

/** 編集して、成功時はログイベント(edited、変更前後の本文・日時)を発行する。 */
export async function editPostAction(
  deps: ActionDeps,
  input: { id: string; authorId: string; content: string; scheduledAt: Date } & Names,
): Promise<EditScheduledPostResult> {
  const now = clock(deps);
  const result = await editScheduledPost(deps.db, { ...input, now });
  if (result.ok) {
    await deps.publish({
      ...eventBase(result.after, input, now),
      action: "edited",
      before: { content: result.before.content, scheduledAt: result.before.scheduledAt.toISOString() },
      after: { content: result.after.content, scheduledAt: result.after.scheduledAt.toISOString() },
    });
  }
  return result;
}

/** 本人による取り消し。成功時はログイベント(cancelled、by=author)を発行する。 */
export async function cancelOwnPostAction(
  deps: ActionDeps,
  input: Omit<CancelScheduledPostInput, "now" | "by"> & Names,
): Promise<ScheduledPostRow | null> {
  const now = clock(deps);
  const row = await cancelScheduledPost(deps.db, { ...input, by: "author", now });
  if (row) await publishCancelled(deps, row, input);
  return row;
}

/**
 * 取り消し済みの予約についてcancelledイベントを発行する。管理者取り消し(Dashboard)は、
 * DBの取り消し後にpg_notifyで通知を受けたBotがexecutor(取り消した管理者)付きで発行する。
 */
export async function publishCancelled(
  deps: ActionDeps,
  row: ScheduledPostRow,
  names: Names,
  executor?: { id: string; name?: string },
): Promise<void> {
  const now = clock(deps);
  await deps.publish({
    ...eventBase(row, names, now),
    executorId: executor?.id,
    executorName: executor?.name,
    action: "cancelled",
    by: row.cancelledBy === "admin" ? "admin" : "author",
    scheduledAt: row.scheduledAt.toISOString(),
  });
}
