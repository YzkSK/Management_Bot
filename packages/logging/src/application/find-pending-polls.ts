import type { Db } from "@management-bot/db";
import { logEntries } from "@management-bot/db";
import { sql } from "drizzle-orm";

export interface PendingPoll {
  guildId: string;
  channelId: string;
  messageId: string;
}

interface PendingPollRow extends Record<string, unknown> {
  guild_id: string;
  channel_id: string;
  message_id: string;
}

/** poll終了の検知漏れ(Botダウン中に投票が締め切られた等)を再照合する対象を、この日数分だけ遡って探す。 */
const PENDING_POLL_LOOKBACK_DAYS = 7;

/**
 * pollカテゴリでaction=createはあるがaction=endがまだ無いメッセージを探す(直近LOOKBACK_DAYS日分)。
 * discord.jsのmessageUpdateで検知するpoll終了(#51 handlers/poll.ts)はBotがダウンしている間の
 * 遷移を取りこぼすため、起動時にこの関数の結果をdiscord層がメッセージ取得して再確認する
 * (実際にresultsFinalizedを確認するのは discord層の責務、ここではDB上の「終了未記録」候補を返すだけ)。
 */
export async function findPendingPolls(db: Db, now: Date = new Date()): Promise<PendingPoll[]> {
  const since = new Date(now.getTime() - PENDING_POLL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows: PendingPollRow[] = await db.execute<PendingPollRow>(sql`
    SELECT DISTINCT ON (creates.payload ->> 'messageId')
      creates.guild_id AS guild_id,
      creates.payload ->> 'channelId' AS channel_id,
      creates.payload ->> 'messageId' AS message_id
    FROM ${logEntries} AS creates
    WHERE creates.category = 'poll'
      AND creates.payload ->> 'action' = 'create'
      AND creates.created_at >= ${since.toISOString()}::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM ${logEntries} AS ends
        WHERE ends.category = 'poll'
          AND ends.payload ->> 'action' = 'end'
          AND ends.payload ->> 'messageId' = creates.payload ->> 'messageId'
      )
  `);

  return rows.map((row) => ({ guildId: row.guild_id, channelId: row.channel_id, messageId: row.message_id }));
}
