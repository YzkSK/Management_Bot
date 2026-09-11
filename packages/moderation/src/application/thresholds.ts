import { eq } from "drizzle-orm";
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
      enabled: moderationThresholds.enabled,
    })
    .from(moderationThresholds)
    .where(eq(moderationThresholds.guildId, guildId));

  return rows
    .filter((row) => row.enabled)
    .map((row) => ({ violationType: row.violationType, preset: row.preset }));
}
