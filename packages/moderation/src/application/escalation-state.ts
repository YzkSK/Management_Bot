import { sql } from "drizzle-orm";
import type { Db } from "@management-bot/db";
import { moderationEscalationState } from "@management-bot/db";
import type { ModerationViolationType } from "@management-bot/shared";

/**
 * (guildId, userId, violationType)のstrikeCountをインクリメントし、更新後の値を返す。
 * lastViolationAtもupsertのたびに更新する(初回違反時刻のまま固定されないようにする)。
 */
export async function incrementStrike(
  db: Db,
  guildId: string,
  userId: string,
  violationType: ModerationViolationType,
): Promise<number> {
  const [row] = await db
    .insert(moderationEscalationState)
    .values({ guildId, userId, violationType, strikeCount: 1 })
    .onConflictDoUpdate({
      target: [
        moderationEscalationState.guildId,
        moderationEscalationState.userId,
        moderationEscalationState.violationType,
      ],
      set: {
        strikeCount: sql`${moderationEscalationState.strikeCount} + 1`,
        lastViolationAt: sql`now()`,
      },
    })
    .returning({ strikeCount: moderationEscalationState.strikeCount });

  if (!row) throw new Error("incrementStrike: upsert returned no row");
  return row.strikeCount;
}
