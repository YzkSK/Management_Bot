import type { Db, ScheduledPostAdminCancelNotification } from "@management-bot/db";
import { SCHEDULED_POST_ADMIN_CANCEL_CHANNEL } from "@management-bot/db";
import { sql } from "drizzle-orm";

/**
 * Dashboardでの管理者取り消し後、予約者へのDMとログイベント発行をBotに依頼するfire-and-forget通知
 * (temp-voiceのnotify-dashboard-actions.tsと同じパターン)。取り消し自体はDB上で完了済み。
 */
export async function notifyScheduledPostAdminCancel(db: Db, notification: ScheduledPostAdminCancelNotification): Promise<void> {
  await db.execute(sql`SELECT pg_notify(${SCHEDULED_POST_ADMIN_CANCEL_CHANNEL}, ${JSON.stringify(notification)})`);
}
