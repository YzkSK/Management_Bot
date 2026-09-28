import type { Db } from "@management-bot/db";
import { logChannelSettings } from "@management-bot/db";
import type { LogCategory } from "@management-bot/shared";
import { and, eq } from "drizzle-orm";
import { mapAllLogCategories, valuesForAllLogCategories } from "./per-category-settings.js";

export interface ChannelSetting {
  category: LogCategory;
  /** 出力先チャンネルID。未設定(その分類のログを送らない)ならnull。 */
  channelId: string | null;
}

/** 全カテゴリ分の出力先チャンネル設定を返す。未設定のカテゴリはchannelId=nullとして補完する。 */
export async function listChannelSettings(db: Db, guildId: string): Promise<ChannelSetting[]> {
  const rows = await db
    .select({ category: logChannelSettings.category, channelId: logChannelSettings.channelId })
    .from(logChannelSettings)
    .where(eq(logChannelSettings.guildId, guildId));

  return mapAllLogCategories(rows, (category, row) => ({ category, channelId: row?.channelId ?? null }));
}

/** channelId=nullは出力先未設定に戻す(該当カテゴリの送信を停止する)。 */
export async function setChannelSetting(
  db: Db,
  guildId: string,
  category: LogCategory,
  channelId: string | null,
): Promise<void> {
  if (channelId === null) {
    await db
      .delete(logChannelSettings)
      .where(and(eq(logChannelSettings.guildId, guildId), eq(logChannelSettings.category, category)));
    return;
  }

  await db
    .insert(logChannelSettings)
    .values({ guildId, category, channelId })
    .onConflictDoUpdate({
      target: [logChannelSettings.guildId, logChannelSettings.category],
      set: { channelId },
    });
}

/** 全カテゴリの出力先チャンネルを一括で同じ値に設定する(カテゴリごとの個別設定は上書きされる)。channelId=nullは全カテゴリ未設定に戻す。 */
export async function setChannelSettingForAllCategories(
  db: Db,
  guildId: string,
  channelId: string | null,
): Promise<void> {
  if (channelId === null) {
    await db.delete(logChannelSettings).where(eq(logChannelSettings.guildId, guildId));
    return;
  }

  await db
    .insert(logChannelSettings)
    .values(valuesForAllLogCategories(guildId, { channelId }))
    .onConflictDoUpdate({
      target: [logChannelSettings.guildId, logChannelSettings.category],
      set: { channelId },
    });
}
