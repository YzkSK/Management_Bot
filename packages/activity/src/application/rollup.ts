import type { Db } from "@management-bot/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { jstDayStart } from "../domain/index.js";

const RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;

/**
 * 90日より前(JSTの日付境界で丸める)のactivity_hourlyをactivity_dailyへ加算し削除する。
 * DELETE ... RETURNINGとINSERTを1文で行うため、加算と削除は原子的に行われる(二重計上しない)。
 * 戻り値は加算先の日次行数。
 */
export async function rollupOldHourly(db: Pick<Db, "execute">, now: Date): Promise<number> {
  const cutoff = jstDayStart(new Date(now.getTime() - RETENTION_DAYS * DAY_MS));
  const rows = await db.execute(sql`
    WITH moved AS (
      DELETE FROM activity_hourly WHERE hour < ${cutoff.toISOString()}::timestamptz
      RETURNING guild_id, user_id, hour, message_count, voice_seconds
    ), agg AS (
      SELECT guild_id, user_id, (hour AT TIME ZONE 'Asia/Tokyo')::date AS day,
             SUM(message_count)::int AS message_count, SUM(voice_seconds)::int AS voice_seconds
      FROM moved GROUP BY 1, 2, 3
    )
    INSERT INTO activity_daily (guild_id, user_id, day, message_count, voice_seconds)
    SELECT guild_id, user_id, day, message_count, voice_seconds FROM agg
    ON CONFLICT (guild_id, user_id, day) DO UPDATE SET
      message_count = activity_daily.message_count + excluded.message_count,
      voice_seconds = activity_daily.voice_seconds + excluded.voice_seconds
    RETURNING 1 AS moved`);
  return z.array(z.unknown()).parse([...rows]).length;
}
