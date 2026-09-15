import { eq } from "drizzle-orm";
import type { Db } from "@management-bot/db";
import { moderationEscalationSettings } from "@management-bot/db";
import type { ModerationPreset } from "@management-bot/shared";

const DEFAULT_ESCALATION_PRESET: ModerationPreset = "medium";

/**
 * guildのエスカレーション強度(weak/medium/strong)を取得する。moderation_thresholdsと
 * 同様、明示的に設定変更されたguildだけがmoderation_escalation_settingsに行を持つため、
 * 未設定時はテーブルに行を作らずデフォルト値をアプリケーション側で返す。
 */
export async function getEscalationPreset(db: Db, guildId: string): Promise<ModerationPreset> {
  const [row] = await db
    .select({ preset: moderationEscalationSettings.preset })
    .from(moderationEscalationSettings)
    .where(eq(moderationEscalationSettings.guildId, guildId));

  return row?.preset ?? DEFAULT_ESCALATION_PRESET;
}

/** guildのエスカレーション強度を作成/更新する。 */
export async function setEscalationPreset(db: Db, guildId: string, preset: ModerationPreset): Promise<void> {
  await db
    .insert(moderationEscalationSettings)
    .values({ guildId, preset })
    .onConflictDoUpdate({ target: moderationEscalationSettings.guildId, set: { preset } });
}
