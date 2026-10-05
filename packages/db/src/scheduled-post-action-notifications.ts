import { discordIdSchema } from "@management-bot/shared";
import { z } from "zod";
import { listenForNotification } from "./pg-notify.js";

const adminCancelSchema = z.object({
  guildId: discordIdSchema,
  postId: z.uuid(),
  /** 取り消した管理者(Dashboardのログインユーザー)。 */
  executorId: discordIdSchema,
  executorName: z.string().optional(),
});

export type ScheduledPostAdminCancelNotification = z.infer<typeof adminCancelSchema>;

export const SCHEDULED_POST_ADMIN_CANCEL_CHANNEL = "scheduled_post_admin_cancel";

/**
 * Dashboard「取り消し」由来のpg_notify('scheduled_post_admin_cancel', ...)を購読する。
 * DB上の取り消し自体はDashboard側で完了済みで、Botは予約者へのDMとログイベント発行のみ行う。
 * (packages/scheduled-post notify-dashboard-actions.tsが直接発行する)
 */
export function listenForScheduledPostAdminCancel(
  databaseUrl: string,
  onNotify: (notification: ScheduledPostAdminCancelNotification) => void,
): { ready: Promise<void>; close: () => Promise<void> } {
  return listenForNotification(databaseUrl, SCHEDULED_POST_ADMIN_CANCEL_CHANNEL, (payload) => {
    const result = adminCancelSchema.safeParse(payload);
    return result.success ? result.data : null;
  }, onNotify);
}
