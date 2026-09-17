import { eq, sql } from "drizzle-orm";
import type { Db } from "@management-bot/db";
import { moderationRaidState } from "@management-bot/db";

/**
 * レイド検知1件ごとにincidentCountを1件加算し、lastRaidAtを現在時刻に更新する
 * (moderation_raid_stateはguildId単位でレイド発生回数を永続化する、設計spec「状態管理」節)。
 */
export async function incrementRaidIncident(db: Db, guildId: string, now: Date): Promise<number> {
  const [row] = await db
    .insert(moderationRaidState)
    .values({ guildId, incidentCount: 1, lastRaidAt: now })
    .onConflictDoUpdate({
      target: moderationRaidState.guildId,
      set: {
        incidentCount: sql`${moderationRaidState.incidentCount} + 1`,
        lastRaidAt: now,
      },
    })
    .returning({ incidentCount: moderationRaidState.incidentCount });

  if (!row) throw new Error("incrementRaidIncident: upsert returned no row");
  return row.incidentCount;
}

/** guildIdのレイド発生状態(累積件数・直近発生時刻)を取得する。未検知の場合はnull。 */
export async function getRaidState(
  db: Db,
  guildId: string,
): Promise<{ incidentCount: number; lastRaidAt: Date } | null> {
  const [row] = await db
    .select({ incidentCount: moderationRaidState.incidentCount, lastRaidAt: moderationRaidState.lastRaidAt })
    .from(moderationRaidState)
    .where(eq(moderationRaidState.guildId, guildId));

  return row ?? null;
}
