import type { Db } from "@management-bot/db";
import { scheduledPostSettings } from "@management-bot/db";
import { eq } from "drizzle-orm";

export interface ScheduledPostSettings {
  /** 「使えるロール」。空配列=メンバー全員が使える。 */
  allowedRoleIds: string[];
  /** 予約で@everyone / @hereをメンションに指定できるか。 */
  allowEveryone: boolean;
  allowHere: boolean;
}

export async function getSettings(db: Db, guildId: string): Promise<ScheduledPostSettings> {
  const [row] = await db
    .select({
      allowedRoleIds: scheduledPostSettings.allowedRoleIds,
      allowEveryone: scheduledPostSettings.allowEveryone,
      allowHere: scheduledPostSettings.allowHere,
    })
    .from(scheduledPostSettings)
    .where(eq(scheduledPostSettings.guildId, guildId));
  return row ?? { allowedRoleIds: [], allowEveryone: false, allowHere: false };
}

export async function getAllowedRoleIds(db: Db, guildId: string): Promise<string[]> {
  return (await getSettings(db, guildId)).allowedRoleIds;
}

/** 設定を丸ごと置き換える。 */
export async function saveSettings(db: Db, guildId: string, settings: ScheduledPostSettings): Promise<void> {
  const values = {
    allowedRoleIds: [...new Set(settings.allowedRoleIds)],
    allowEveryone: settings.allowEveryone,
    allowHere: settings.allowHere,
  };
  await db
    .insert(scheduledPostSettings)
    .values({ guildId, ...values })
    .onConflictDoUpdate({
      target: scheduledPostSettings.guildId,
      set: { ...values, updatedAt: new Date() },
    });
}
