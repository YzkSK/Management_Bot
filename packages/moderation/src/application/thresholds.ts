import { and, eq } from "drizzle-orm";
import type { Db } from "@management-bot/db";
import { moderationThresholds } from "@management-bot/db";
import type { ModerationViolationType } from "@management-bot/shared";
import type { ModerationPreset } from "../domain/index.js";

export interface EnabledThreshold {
  violationType: ModerationViolationType;
  preset: ModerationPreset;
}

/** guildIdで有効化されている検知種別(flood/duplicate_content)ごとのプリセットを取得する。 */
export async function getEnabledThresholds(db: Db, guildId: string): Promise<EnabledThreshold[]> {
  const rows = await db
    .select({
      violationType: moderationThresholds.violationType,
      preset: moderationThresholds.preset,
    })
    .from(moderationThresholds)
    .where(and(eq(moderationThresholds.guildId, guildId), eq(moderationThresholds.enabled, true)));

  return rows;
}

export interface ThresholdSetting {
  violationType: ModerationViolationType;
  preset: ModerationPreset;
  enabled: boolean;
}

/** guildIdの検知種別(flood/duplicate_content)ごとの設定(enabled/preset)を全件取得する。未設定の種別は含まれない。 */
export async function listThresholds(db: Db, guildId: string): Promise<ThresholdSetting[]> {
  return db
    .select({
      violationType: moderationThresholds.violationType,
      preset: moderationThresholds.preset,
      enabled: moderationThresholds.enabled,
    })
    .from(moderationThresholds)
    .where(eq(moderationThresholds.guildId, guildId));
}

/** guildId+violationTypeの設定(enabled/preset)を作成/更新する。 */
export async function setThreshold(
  db: Db,
  guildId: string,
  violationType: ModerationViolationType,
  preset: ModerationPreset,
  enabled: boolean,
): Promise<void> {
  await db
    .insert(moderationThresholds)
    .values({ guildId, violationType, preset, enabled })
    .onConflictDoUpdate({
      target: [moderationThresholds.guildId, moderationThresholds.violationType],
      set: { preset, enabled },
    });
}
