import { activityHourly, type Db } from "@management-bot/db";
import { sql } from "drizzle-orm";

export interface HourlyDelta {
  guildId: string;
  userId: string;
  hour: Date;
  messageCount: number;
  voiceSeconds: number;
}

/** 時間単位の活動量を加算する。同一キーは先に合算する(1文のINSERT内で同一行を2回更新できないため)。 */
export async function addHourlyActivity(db: Db, deltas: readonly HourlyDelta[]): Promise<void> {
  const merged = new Map<string, HourlyDelta>();
  for (const d of deltas) {
    const key = `${d.guildId}:${d.userId}:${d.hour.getTime()}`;
    const prev = merged.get(key);
    merged.set(
      key,
      prev
        ? { ...prev, messageCount: prev.messageCount + d.messageCount, voiceSeconds: prev.voiceSeconds + d.voiceSeconds }
        : { ...d },
    );
  }
  if (merged.size === 0) return;
  await db
    .insert(activityHourly)
    .values([...merged.values()])
    .onConflictDoUpdate({
      target: [activityHourly.guildId, activityHourly.userId, activityHourly.hour],
      set: {
        messageCount: sql`${activityHourly.messageCount} + excluded.message_count`,
        voiceSeconds: sql`${activityHourly.voiceSeconds} + excluded.voice_seconds`,
      },
    });
}
