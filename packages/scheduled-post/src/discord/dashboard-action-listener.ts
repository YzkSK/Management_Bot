import type { ScheduledPostAdminCancelNotification } from "@management-bot/db";
import { listenForScheduledPostAdminCancel } from "@management-bot/db";
import {
  claimAdminCancelNotice,
  claimPendingAdminCancelNotices,
  type ScheduledPostRow,
} from "../application/index.js";
import { buildAdminCancelDm } from "../domain/index.js";
import { publishCancelled, type ActionDeps } from "./schedule-actions.js";

/** 名前解決とDM送信(Discord依存)。本番はdiscord.jsのClient、テストはフェイクを渡す。 */
export interface AdminCancelDiscord {
  channelName: (channelId: string) => string | undefined;
  authorName: (userId: string) => string | undefined;
  sendDm: (userId: string, text: string) => Promise<void>;
}

type AdminCancelDeps = ActionDeps & { discord: AdminCancelDiscord };

/** claim済みの管理者取り消し1件の後処理(ログイベント発行と予約者へのDM)。DM失敗はログのみ。 */
async function notifyAdminCancel(deps: AdminCancelDeps, row: ScheduledPostRow): Promise<void> {
  await publishCancelled(
    deps,
    row,
    { channelName: deps.discord.channelName(row.channelId), authorName: deps.discord.authorName(row.authorId) },
    row.cancelledByUserId ? { id: row.cancelledByUserId, name: row.cancelledByUserName ?? undefined } : undefined,
  );
  try {
    await deps.discord.sendDm(
      row.authorId,
      buildAdminCancelDm({
        channelId: row.channelId,
        scheduledAt: row.scheduledAt,
        content: row.content,
        now: (deps.now ?? (() => new Date()))(),
      }),
    );
  } catch (error) {
    console.warn(`scheduled-post: failed to DM author ${row.authorId} about admin cancellation of post ${row.id}`, error);
  }
}

function clock(deps: ActionDeps): Date {
  return (deps.now ?? (() => new Date()))();
}

/**
 * pg_notify受信時の後処理。claim(cancel_notified_atの条件付きUPDATE)に成功したプロセスだけが処理するため、
 * Botが複数あっても、tick回収と競合しても1回だけ実行される。
 */
export async function handleAdminCancelNotification(
  deps: AdminCancelDeps,
  notification: ScheduledPostAdminCancelNotification,
): Promise<void> {
  const row = await claimAdminCancelNotice(deps.db, notification.postId, clock(deps), notification.guildId);
  if (row) await notifyAdminCancel(deps, row);
}

/** tickごとの回収。通知を取りこぼした(Bot停止中など)管理者取り消しを一定件数ずつclaimして後処理する。 */
export async function processPendingAdminCancels(deps: AdminCancelDeps): Promise<void> {
  const rows = await claimPendingAdminCancelNotices(deps.db, clock(deps));
  for (const row of rows) {
    try {
      await notifyAdminCancel(deps, row);
    } catch (error) {
      console.error(`scheduled-post: failed to process admin cancellation of post ${row.id}`, error);
    }
  }
}

/**
 * 起動時にDashboard操作(管理者取り消し)のpg_notifyを購読する。購読失敗はログ出力のみに留め、
 * bot起動をブロックしない(temp-voiceのdashboard-action-listenerと同じ設計)。
 */
export function registerDashboardActionListener(
  deps: ActionDeps & { discord: AdminCancelDiscord; databaseUrl: string },
): { close: () => Promise<void> } {
  const listener = listenForScheduledPostAdminCancel(deps.databaseUrl, (notification) => {
    handleAdminCancelNotification(deps, notification).catch((error: unknown) => {
      console.error("scheduled-post: unhandled error in admin-cancel notification handler", error);
    });
  });
  listener.ready.catch((error: unknown) => {
    console.error("Failed to listen for scheduled_post_admin_cancel", error);
  });
  return { close: listener.close };
}
