import { activityHourly, type Db } from "@management-bot/db";
import { sql } from "drizzle-orm";

export interface HourlyDelta {
  guildId: string;
  userId: string;
  hour: Date;
  messageCount: number;
  voiceSeconds: number;
  lastMessageAt?: Date;
  lastVoiceAt?: Date;
}

export function laterOf(a: Date | undefined, b: Date | undefined): Date | undefined {
  return a && b ? (a > b ? a : b) : (a ?? b);
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
        ? {
            ...prev,
            messageCount: prev.messageCount + d.messageCount,
            voiceSeconds: prev.voiceSeconds + d.voiceSeconds,
            lastMessageAt: laterOf(prev.lastMessageAt, d.lastMessageAt),
            lastVoiceAt: laterOf(prev.lastVoiceAt, d.lastVoiceAt),
          }
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
        // GREATESTはNULLを無視する
        lastMessageAt: sql`GREATEST(${activityHourly.lastMessageAt}, excluded.last_message_at)`,
        lastVoiceAt: sql`GREATEST(${activityHourly.lastVoiceAt}, excluded.last_voice_at)`,
      },
    });
}
