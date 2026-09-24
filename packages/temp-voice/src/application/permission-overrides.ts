import type { Db } from "@management-bot/db";
import { tempVoiceDenyProtectedRoles, tempVoicePermissionOverrides } from "@management-bot/db";
import { and, eq } from "drizzle-orm";

export type TempVoicePermissionTargetType = "user" | "role";
export type TempVoicePermissionState = "allow" | "deny";

export interface TempVoicePermissionOverrideRow {
  channelId: string;
  targetType: TempVoicePermissionTargetType;
  targetId: string;
  state: TempVoicePermissionState;
}

/** 制御パネルのメンバー管理一覧(#408/#409)に表示する登録済みoverride一覧を返す。 */
export async function listPermissionOverrides(db: Db, channelId: string): Promise<TempVoicePermissionOverrideRow[]> {
  return db
    .select({
      channelId: tempVoicePermissionOverrides.channelId,
      targetType: tempVoicePermissionOverrides.targetType,
      targetId: tempVoicePermissionOverrides.targetId,
      state: tempVoicePermissionOverrides.state,
    })
    .from(tempVoicePermissionOverrides)
    .where(eq(tempVoicePermissionOverrides.channelId, channelId));
}

/** 個別許可・拒否の登録(UPSERT)。同一targetへの再登録はstateを上書きする。 */
export async function upsertPermissionOverride(
  db: Db,
  input: TempVoicePermissionOverrideRow,
): Promise<void> {
  await db
    .insert(tempVoicePermissionOverrides)
    .values(input)
    .onConflictDoUpdate({
      target: [tempVoicePermissionOverrides.channelId, tempVoicePermissionOverrides.targetType, tempVoicePermissionOverrides.targetId],
      set: { state: input.state },
    });
}

/** メンバー管理からの解除(#409)。DBレコードを削除する。 */
export async function deletePermissionOverride(
  db: Db,
  channelId: string,
  targetType: TempVoicePermissionTargetType,
  targetId: string,
): Promise<void> {
  await db
    .delete(tempVoicePermissionOverrides)
    .where(
      and(
        eq(tempVoicePermissionOverrides.channelId, channelId),
        eq(tempVoicePermissionOverrides.targetType, targetType),
        eq(tempVoicePermissionOverrides.targetId, targetId),
      ),
    );
}

/** サーバー管理者が保護指定したロールIDの一覧を返す(#409、Dashboard UI側の設定はDB直接参照)。 */
export async function listDenyProtectedRoleIds(db: Db, guildId: string): Promise<string[]> {
  const rows = await db
    .select({ roleId: tempVoiceDenyProtectedRoles.roleId })
    .from(tempVoiceDenyProtectedRoles)
    .where(eq(tempVoiceDenyProtectedRoles.guildId, guildId));
  return rows.map((row) => row.roleId);
}

/**
 * roleIdが拒否指定できない保護対象かどうかを判定する。`@everyone`(roleId===guildId)は
 * 常に暗黙的に保護する(拒否指定するとlock機能と意味が重複し全員締め出しになるため)。
 */
export async function isDenyProtectedRole(db: Db, guildId: string, roleId: string): Promise<boolean> {
  if (roleId === guildId) return true;
  const protectedRoleIds = await listDenyProtectedRoleIds(db, guildId);
  return protectedRoleIds.includes(roleId);
}

/**
 * Dashboard拒否禁止ロールタブの保存で使う(#415)。DELETE→INSERTをトランザクションで
 * 行い、全件置き換えの途中状態が他リクエストから見えないようにする。
 */
export async function replaceDenyProtectedRoles(db: Db, guildId: string, roleIds: readonly string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(tempVoiceDenyProtectedRoles).where(eq(tempVoiceDenyProtectedRoles.guildId, guildId));
    if (roleIds.length > 0) {
      await tx.insert(tempVoiceDenyProtectedRoles).values(roleIds.map((roleId) => ({ guildId, roleId })));
    }
  });
}
