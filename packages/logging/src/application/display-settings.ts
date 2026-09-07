import type { Db } from "@management-bot/db";
import { logDisplaySettings } from "@management-bot/db";
import { eq } from "drizzle-orm";

export interface DisplaySettings {
  hideAuditLogCorrelation: boolean;
  hideBotEvents: boolean;
}

/** 未設定のguildはデフォルト値(hideAuditLogCorrelation=true, hideBotEvents=true)を返す。 */
export async function getDisplaySettings(db: Db, guildId: string): Promise<DisplaySettings> {
  const [row] = await db
    .select({
      hideAuditLogCorrelation: logDisplaySettings.hideAuditLogCorrelation,
      hideBotEvents: logDisplaySettings.hideBotEvents,
    })
    .from(logDisplaySettings)
    .where(eq(logDisplaySettings.guildId, guildId));
  return {
    hideAuditLogCorrelation: row?.hideAuditLogCorrelation ?? true,
    hideBotEvents: row?.hideBotEvents ?? true,
  };
}

/**
 * patchで指定したフィールドのみ更新する(部分更新)。既存行のset全体を毎回上書きすると、
 * 複数の設定項目を別々のリクエストで変更した際に後着が先着の変更を巻き戻すため(codexレビュー指摘)。
 * 未存在guildの初回作成時、patchに含まれないフィールドはデフォルト値(true)で埋める。
 */
export async function setDisplaySetting(
  db: Db,
  guildId: string,
  patch: Partial<DisplaySettings>,
): Promise<void> {
  await db
    .insert(logDisplaySettings)
    .values({
      guildId,
      hideAuditLogCorrelation: patch.hideAuditLogCorrelation ?? true,
      hideBotEvents: patch.hideBotEvents ?? true,
    })
    .onConflictDoUpdate({
      target: logDisplaySettings.guildId,
      set: patch,
    });
}
