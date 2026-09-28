import type { Db } from "@management-bot/db";
import { sql } from "drizzle-orm";

/**
 * Dashboard操作(自動セットアップ・強制削除)をbotへ指示するfire-and-forget通知(#415)。
 * 既存のDBトリガー由来pg_notify(moderation-config-notifications.ts等)とは別パターンで、
 * tRPC procedure側から直接SQLのpg_notify()を呼ぶ。専用テーブルは持たない
 * (状態を持続させる必要のない一回きりの指示のため、issue本文の設計方針)。
 */
export async function notifyTempVoiceAutoSetup(db: Db, guildId: string): Promise<void> {
  await db.execute(sql`SELECT pg_notify('temp_voice_auto_setup', ${JSON.stringify({ guildId })})`);
}

export async function notifyTempVoiceForceDelete(db: Db, guildId: string, channelId: string): Promise<void> {
  await db.execute(sql`SELECT pg_notify('temp_voice_force_delete', ${JSON.stringify({ guildId, channelId })})`);
}
