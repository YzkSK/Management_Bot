import { eq } from "drizzle-orm";
import type { Db } from "@management-bot/db";
import { moderationWhitelist } from "@management-bot/db";

/** guildId内のホワイトリストに、対象ユーザーIDまたは指定ロールIDのいずれかが登録されているかを判定する。 */
export async function isWhitelisted(
  db: Db,
  guildId: string,
  userId: string,
  roleIds: readonly string[],
): Promise<boolean> {
  const rows = await db
    .select({ targetType: moderationWhitelist.targetType, targetId: moderationWhitelist.targetId })
    .from(moderationWhitelist)
    .where(eq(moderationWhitelist.guildId, guildId));

  return rows.some(
    (row) =>
      (row.targetType === "user" && row.targetId === userId) ||
      (row.targetType === "role" && roleIds.includes(row.targetId)),
  );
}
