import { and, eq, inArray, or } from "drizzle-orm";
import type { Db } from "@management-bot/db";
import { moderationWhitelist } from "@management-bot/db";

/** guildId内のホワイトリストに、対象ユーザーIDまたは指定ロールIDのいずれかが登録されているかを判定する。 */
export async function isWhitelisted(
  db: Db,
  guildId: string,
  userId: string,
  roleIds: readonly string[],
): Promise<boolean> {
  const targetMatch = or(
    and(eq(moderationWhitelist.targetType, "user"), eq(moderationWhitelist.targetId, userId)),
    ...(roleIds.length === 0
      ? []
      : [and(eq(moderationWhitelist.targetType, "role"), inArray(moderationWhitelist.targetId, [...roleIds]))]),
  );

  const [row] = await db
    .select({ targetId: moderationWhitelist.targetId })
    .from(moderationWhitelist)
    .where(and(eq(moderationWhitelist.guildId, guildId), targetMatch))
    .limit(1);

  return row !== undefined;
}
