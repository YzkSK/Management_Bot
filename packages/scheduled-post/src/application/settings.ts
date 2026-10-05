import type { Db } from "@management-bot/db";
import { guildFeatureToggles, scheduledPostSettings } from "@management-bot/db";
import { and, eq } from "drizzle-orm";

export const SCHEDULED_POST_FEATURE_KEY = "scheduled-post";

/**
 * 機能がギルドで有効か。guild_feature_togglesに行が無い(機能追加前に参加したギルド等)場合は
 * 既定値(defaultEnabled=false)に倒して無効扱いにする。
 */
export async function isScheduledPostEnabled(db: Db, guildId: string): Promise<boolean> {
  const [row] = await db
    .select({ enabled: guildFeatureToggles.enabled })
    .from(guildFeatureToggles)
    .where(
      and(eq(guildFeatureToggles.guildId, guildId), eq(guildFeatureToggles.featureKey, SCHEDULED_POST_FEATURE_KEY)),
    );
  return row?.enabled ?? false;
}

/** 機能のON/OFF。OFFにしても予約は消えず、投稿のみ止まる(ONに戻すと再開)。 */
export async function setScheduledPostEnabled(db: Db, guildId: string, enabled: boolean): Promise<void> {
  await db
    .insert(guildFeatureToggles)
    .values({ guildId, featureKey: SCHEDULED_POST_FEATURE_KEY, enabled })
    .onConflictDoUpdate({
      target: [guildFeatureToggles.guildId, guildFeatureToggles.featureKey],
      set: { enabled },
    });
}

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
