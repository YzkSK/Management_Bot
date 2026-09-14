import type { Db } from "@management-bot/db";
import { logEntries } from "@management-bot/db";
import { and, eq, sql } from "drizzle-orm";

export interface MemberJoinFlags {
  /** 同一guild×userIdでmember(join/leave)の過去ログが存在する場合true(再入室)。 */
  isRejoin: boolean;
  /** 同一guild×userIdでmoderationCase(kick/ban)の過去ログが存在する場合true。 */
  hasModerationHistory: boolean;
}

/**
 * guildMemberAdd時点で、対象ユーザーの過去ログから警告バッジ表示用のフラグを判定する。
 * 参加ログ自体(guildMemberAddが呼ぶtoMemberJoinLogEntry)より前に発生した行のみを見る必要があるため、
 * このクエリはwriteLogEntry(今回のjoinのINSERT)より前に呼ぶこと。
 */
export async function getMemberJoinFlags(db: Db, guildId: string, userId: string): Promise<MemberJoinFlags> {
  const [rejoinRow] = await db
    .select({ id: logEntries.id })
    .from(logEntries)
    .where(
      and(
        eq(logEntries.guildId, guildId),
        eq(logEntries.category, "member"),
        sql`${logEntries.payload} ->> 'userId' = ${userId}`,
        sql`${logEntries.payload} ->> 'action' IN ('join', 'leave')`,
      ),
    )
    .limit(1);

  const [moderationRow] = await db
    .select({ id: logEntries.id })
    .from(logEntries)
    .where(
      and(
        eq(logEntries.guildId, guildId),
        eq(logEntries.category, "moderationCase"),
        sql`${logEntries.payload} ->> 'targetUserId' = ${userId}`,
        sql`${logEntries.payload} ->> 'actionType' IN ('kick', 'ban')`,
      ),
    )
    .limit(1);

  return { isRejoin: rejoinRow !== undefined, hasModerationHistory: moderationRow !== undefined };
}
