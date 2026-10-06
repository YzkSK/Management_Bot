import type { Db } from "@management-bot/db";
import type { ScheduledPostFailureReason } from "@management-bot/shared";
import {
  RETENTION_DAYS,
  claimDuePosts,
  getAllowedRoleIds,
  markFailed,
  markPosted,
  purgeFinishedPosts,
  recoverStuckPosting,
  type ScheduledPostRow,
} from "../application/index.js";
import {
  EXPIRY_MS,
  buildAllowedMentions,
  buildFailureDm,
  classifySendErrorCode,
  decidePostability,
  type AllowedMentionsSpec,
  type PostFacts,
} from "../domain/index.js";
import type { PublishScheduledPostEvent } from "./events.js";
import type { PostView } from "./post-message.js";

export const SCHEDULER_INTERVAL_MS = 15_000;
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

export interface PostInspection {
  facts: PostFacts;
  /** 実行者がそのチャンネルでMentionEveryone権限を持つか。 */
  canMentionEveryone: boolean;
  isRoleMentionable: (roleId: string) => boolean;
  channelName?: string;
  authorName?: string;
  /** 予約者のギルドアバター(なければユーザーアバター)。投稿Embedのauthorアイコンに使う。 */
  authorAvatarUrl?: string;
}

/** Discordへの依存を閉じ込める境界。本番はgateway.ts、テストはフェイクを注入する。 */
export interface SchedulerGateway {
  /** 投稿直前の事実収集(在籍・チャンネル・権限)。 */
  inspect: (post: { guildId: string; channelId: string; authorId: string }) => Promise<PostInspection>;
  /** 本文を投稿する。失敗時はDiscord APIエラー(`code`を持つ)を投げる。 */
  send: (
    post: { channelId: string; content: string },
    view: PostView,
    allowedMentions: AllowedMentionsSpec,
  ) => Promise<{ messageId: string }>;
  /** 予約者へDMする。届かない場合は例外を投げる(呼び出し側がログのみに落とす)。 */
  sendDm: (userId: string, text: string) => Promise<void>;
}

export interface SchedulerDeps {
  db: Db;
  gateway: SchedulerGateway;
  publish: PublishScheduledPostEvent;
  now?: () => Date;
}

function errorCodeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

function baseEvent(post: ScheduledPostRow, names: { channelName?: string; authorName?: string }, now: Date) {
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

/** 失敗を確定(posting→failed)し、ログイベント発行と予約者へのDMを行う。DM失敗はログのみ。 */
async function finishFailed(
  deps: SchedulerDeps,
  post: ScheduledPostRow,
  reason: ScheduledPostFailureReason,
  names: { channelName?: string; authorName?: string } = {},
): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const failed = await markFailed(deps.db, post.id, reason, now);
  if (!failed) return;
  await deps.publish({
    ...baseEvent(post, names, now),
    action: "failed",
    reason,
    scheduledAt: post.scheduledAt.toISOString(),
  });
  try {
    await deps.gateway.sendDm(
      post.authorId,
      buildFailureDm({ reason, channelId: post.channelId, scheduledAt: post.scheduledAt, content: post.content, now }),
    );
  } catch (error) {
    console.warn(`scheduled-post: failed to DM author ${post.authorId} about failed post ${post.id}`, error);
  }
}

/** claim済みの予約1件を処理する。例外は呼び出し元で握りつぶされるため、Botを落とさない。 */
export async function processClaimedPost(deps: SchedulerDeps, post: ScheduledPostRow): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  if (now.getTime() - post.scheduledAt.getTime() > EXPIRY_MS) {
    await finishFailed(deps, post, "expired");
    return;
  }

  let inspection: PostInspection;
  try {
    inspection = await deps.gateway.inspect(post);
  } catch (error) {
    console.error(`scheduled-post: failed to inspect post ${post.id}`, error);
    await finishFailed(deps, post, "send_failed");
    return;
  }
  const names = { channelName: inspection.channelName, authorName: inspection.authorName };

  const allowedRoleIds = await getAllowedRoleIds(deps.db, post.guildId);
  const decision = decidePostability(inspection.facts, allowedRoleIds);
  if (!decision.ok) {
    await finishFailed(deps, post, decision.reason, names);
    return;
  }

  let messageId: string;
  try {
    const sent = await deps.gateway.send(
      post,
      {
        authorName: inspection.authorName ?? "予約者",
        authorAvatarUrl: inspection.authorAvatarUrl ?? "",
      },
      buildAllowedMentions(post.content, inspection.canMentionEveryone, inspection.isRoleMentionable),
    );
    messageId = sent.messageId;
  } catch (error) {
    console.warn(`scheduled-post: failed to send post ${post.id}`, error);
    await finishFailed(deps, post, classifySendErrorCode(errorCodeOf(error)), names);
    return;
  }

  // 送信後にDB更新が失敗した場合はpostingのまま残り、STUCK_POSTING_MS経過後にunknown_result(再送しない)として扱われる。
  const finishedAt = (deps.now ?? (() => new Date()))();
  const posted = await markPosted(deps.db, post.id, messageId, finishedAt);
  if (!posted) return;
  await deps.publish({
    ...baseEvent(post, names, finishedAt),
    action: "posted",
    messageId,
    scheduledAt: post.scheduledAt.toISOString(),
  });
}

/**
 * 毎tick実行する。一定時間以上postingのまま残った予約(投稿途中でBotが落ちた)は
 * 送れたか分からないため再送せず、failed/unknown_resultにして通知する。
 */
export async function recoverInterruptedPosts(deps: SchedulerDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const recovered = await recoverStuckPosting(deps.db, now);
  for (const post of recovered) {
    try {
      await deps.publish({
        ...baseEvent(post, {}, now),
        action: "failed",
        reason: "unknown_result",
        scheduledAt: post.scheduledAt.toISOString(),
      });
      await deps.gateway.sendDm(
        post.authorId,
        buildFailureDm({
          reason: "unknown_result",
          channelId: post.channelId,
          scheduledAt: post.scheduledAt,
          content: post.content,
          now,
        }),
      );
    } catch (error) {
      console.warn(`scheduled-post: failed to notify about interrupted post ${post.id}`, error);
    }
  }
}

/** 時刻が来た予約をclaimして順に処理する。1件の失敗が他の予約・プロセスに波及しない。 */
export async function runSchedulerTick(deps: SchedulerDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const claimed = await claimDuePosts(deps.db, now);
  for (const post of claimed) {
    try {
      await processClaimedPost(deps, post);
    } catch (error) {
      console.error(`scheduled-post: unexpected error while processing post ${post.id}`, error);
    }
  }
}

export interface Scheduler {
  /** 定期実行を始める(posting残留の回復も各tickで行う)。 */
  start: () => Promise<void>;
  /** 定期実行を止め、実行中の処理の完了を待つ。 */
  stop: () => Promise<void>;
}

/**
 * Botプロセス内の定期実行(15秒ごと)。多重実行防止フラグにより前回のtickが終わるまで次を始めない。
 * 終了済み予約の削除(30日経過)は1時間に1回程度、tickに相乗りして行う。
 */
export function createScheduler(deps: SchedulerDeps, intervalMs: number = SCHEDULER_INTERVAL_MS): Scheduler {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | undefined;
  let lastPurgeAt = 0;
  const clock = deps.now ?? (() => new Date());

  const tick = (): void => {
    if (running) return;
    running = (async () => {
      try {
        // 起動直後だけでなく毎tick確認する(経過時間で判定するため、起動時点ではまだ対象外の行もある)。
        await recoverInterruptedPosts(deps);
        await runSchedulerTick(deps);
        const now = clock();
        if (now.getTime() - lastPurgeAt >= PURGE_INTERVAL_MS) {
          lastPurgeAt = now.getTime();
          const purged = await purgeFinishedPosts(deps.db, now);
          if (purged > 0) console.log(`scheduled-post: purged ${purged} finished posts older than ${RETENTION_DAYS} days`);
        }
      } catch (error) {
        console.error("scheduled-post: scheduler tick failed", error);
      } finally {
        running = undefined;
      }
    })();
  };

  return {
    start: async () => {
      tick();
      timer = setInterval(tick, intervalMs);
    },
    stop: async () => {
      if (timer) clearInterval(timer);
      timer = undefined;
      await running;
    },
  };
}
