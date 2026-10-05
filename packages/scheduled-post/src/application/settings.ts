import type { Db } from "@management-bot/db";
import { scheduledPostSettings } from "@management-bot/db";
import { eq } from "drizzle-orm";

/** 「使えるロール」。空配列=メンバー全員が使える。 */
export async function getAllowedRoleIds(db: Db, guildId: string): Promise<string[]> {
  const [row] = await db
    .select({ allowedRoleIds: scheduledPostSettings.allowedRoleIds })
    .from(scheduledPostSettings)
    .where(eq(scheduledPostSettings.guildId, guildId));
  return row?.allowedRoleIds ?? [];
}

export async function setAllowedRoleIds(db: Db, guildId: string, roleIds: readonly string[]): Promise<void> {
  const unique = [...new Set(roleIds)];
  await db
    .insert(scheduledPostSettings)
    .values({ guildId, allowedRoleIds: unique })
    .onConflictDoUpdate({
      target: scheduledPostSettings.guildId,
      set: { allowedRoleIds: unique, updatedAt: new Date() },
    });
}
