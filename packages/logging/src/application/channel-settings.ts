import type { Db } from "@management-bot/db";
import { logChannelSettings } from "@management-bot/db";
import { LOG_CATEGORIES, type LogCategory } from "@management-bot/shared";
import { and, eq } from "drizzle-orm";

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

  const byCategory = new Map(rows.map((row) => [row.category, row.channelId]));

  return LOG_CATEGORIES.map((category) => ({
    category,
    channelId: byCategory.get(category) ?? null,
  }));
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
