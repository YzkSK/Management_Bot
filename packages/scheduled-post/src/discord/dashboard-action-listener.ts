import type { ScheduledPostAdminCancelNotification } from "@management-bot/db";
import { listenForScheduledPostAdminCancel } from "@management-bot/db";
import { getScheduledPost } from "../application/index.js";
import { buildAdminCancelDm } from "../domain/index.js";
import { publishCancelled, type ActionDeps } from "./schedule-actions.js";

/** 名前解決とDM送信(Discord依存)。本番はdiscord.jsのClient、テストはフェイクを渡す。 */
export interface AdminCancelDiscord {
  channelName: (channelId: string) => string | undefined;
  authorName: (userId: string) => string | undefined;
  sendDm: (userId: string, text: string) => Promise<void>;
}

/**
 * Dashboardで管理者が取り消した後のBot側の後処理: ログイベント(cancelled、by=admin)の発行と、
 * 予約者へのDM(届かない場合はログのみ)。取り消し自体はDashboard側でDB上は完了済みのため、
 * 取り消された予約でなければ何もしない。
 */
export async function handleAdminCancelNotification(
  deps: ActionDeps & { discord: AdminCancelDiscord },
  notification: ScheduledPostAdminCancelNotification,
): Promise<void> {
  const row = await getScheduledPost(deps.db, notification.postId);
  if (!row || row.guildId !== notification.guildId || row.status !== "cancelled" || row.cancelledBy !== "admin") return;

  await publishCancelled(
    deps,
    row,
    { channelName: deps.discord.channelName(row.channelId), authorName: deps.discord.authorName(row.authorId) },
    { id: notification.executorId, name: notification.executorName },
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
