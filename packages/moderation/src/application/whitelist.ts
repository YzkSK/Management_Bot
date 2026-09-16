import { and, eq, inArray, or } from "drizzle-orm";
import type { Db } from "@management-bot/db";
import { moderationWhitelist } from "@management-bot/db";

export type ModerationWhitelistTargetType = "user" | "role";

export interface WhitelistEntry {
  targetType: ModerationWhitelistTargetType;
  targetId: string;
}

/** guildIdのホワイトリスト全件を返す。 */
export async function listWhitelist(db: Db, guildId: string): Promise<WhitelistEntry[]> {
  return db
    .select({ targetType: moderationWhitelist.targetType, targetId: moderationWhitelist.targetId })
    .from(moderationWhitelist)
    .where(eq(moderationWhitelist.guildId, guildId));
}

/** guildIdのホワイトリストへ対象を追加する(既に存在する場合は何もしない)。 */
export async function addToWhitelist(db: Db, entry: { guildId: string } & WhitelistEntry): Promise<void> {
  await db.insert(moderationWhitelist).values(entry).onConflictDoNothing();
}

/** guildIdのホワイトリストから対象を削除する(未登録の場合は何もしない)。 */
export async function removeFromWhitelist(db: Db, entry: { guildId: string } & WhitelistEntry): Promise<void> {
  await db
    .delete(moderationWhitelist)
    .where(
      and(
        eq(moderationWhitelist.guildId, entry.guildId),
        eq(moderationWhitelist.targetType, entry.targetType),
        eq(moderationWhitelist.targetId, entry.targetId),
      ),
    );
}

/** guildId内のホワイトリストに、対象ユーザーIDまたは指定ロールIDのいずれかが登録されているかを判定する。 */
export async function isWhitelisted(
  db: Db,
  guildId: string,
  userId: string,
  roleIds: readonly string[],
): Promise<boolean> {
  // `@everyone`(roleId===guildId)は全メンバーが持つロールのため、万一ホワイトリストに
  // 登録されていても一致対象から除外する(router側でも追加自体を拒否しているが、
  // モデレーション機能全停止という影響の大きさから二重に防御する)。
  const applicableRoleIds = roleIds.filter((roleId) => roleId !== guildId);
  const targetMatch = or(
    and(eq(moderationWhitelist.targetType, "user"), eq(moderationWhitelist.targetId, userId)),
    ...(applicableRoleIds.length === 0
      ? []
      : [and(eq(moderationWhitelist.targetType, "role"), inArray(moderationWhitelist.targetId, applicableRoleIds))]),
  );

  const [row] = await db
    .select({ targetId: moderationWhitelist.targetId })
    .from(moderationWhitelist)
    .where(and(eq(moderationWhitelist.guildId, guildId), targetMatch))
    .limit(1);

  return row !== undefined;
}
