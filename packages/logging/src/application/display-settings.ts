import type { Db } from "@management-bot/db";
import { logDisplaySettings } from "@management-bot/db";
import { eq } from "drizzle-orm";

export interface DisplaySettings {
  hideAuditLogCorrelation: boolean;
}

/** 未設定のguildはデフォルト値(hideAuditLogCorrelation=true)を返す。 */
export async function getDisplaySettings(db: Db, guildId: string): Promise<DisplaySettings> {
  const [row] = await db
    .select({ hideAuditLogCorrelation: logDisplaySettings.hideAuditLogCorrelation })
    .from(logDisplaySettings)
    .where(eq(logDisplaySettings.guildId, guildId));
  return { hideAuditLogCorrelation: row?.hideAuditLogCorrelation ?? true };
}

export async function setDisplaySetting(
  db: Db,
  guildId: string,
  hideAuditLogCorrelation: boolean,
): Promise<void> {
  await db
    .insert(logDisplaySettings)
    .values({ guildId, hideAuditLogCorrelation })
    .onConflictDoUpdate({
      target: logDisplaySettings.guildId,
      set: { hideAuditLogCorrelation },
    });
}
