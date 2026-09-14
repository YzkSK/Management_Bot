import type { Db } from "@management-bot/db";
import { capabilityGrants } from "@management-bot/db";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export type CapabilityGrantTargetType = "user" | "role";

export interface CapabilityGrant {
  id: string;
  targetType: CapabilityGrantTargetType;
  targetId: string;
  capabilities: number;
}

/** guild内の全capability grant(user/role双方)を返す。@everyoneロールへの付与はtargetId===guildIdのroleレコードで表現される。 */
export async function listCapabilityGrants(db: Db, guildId: string): Promise<CapabilityGrant[]> {
  const rows = await db
    .select({
      id: capabilityGrants.id,
      targetType: capabilityGrants.targetType,
      targetId: capabilityGrants.targetId,
      capabilities: capabilityGrants.capabilities,
    })
    .from(capabilityGrants)
    .where(eq(capabilityGrants.guildId, guildId));

  return rows.map((row) => ({ ...row, targetType: row.targetType as CapabilityGrantTargetType }));
}

export interface GetCapabilityGrantInput {
  guildId: string;
  targetType: CapabilityGrantTargetType;
  targetId: string;
}

/** 指定targetの既存grantを1件返す(未付与ならnull)。grant更新時の昇格防止チェック・剥奪処理で使う。 */
export async function getCapabilityGrant(
  db: Db,
  input: GetCapabilityGrantInput,
): Promise<CapabilityGrant | null> {
  const { guildId, targetType, targetId } = input;
  const [row] = await db
    .select({
      id: capabilityGrants.id,
      targetType: capabilityGrants.targetType,
      targetId: capabilityGrants.targetId,
      capabilities: capabilityGrants.capabilities,
    })
    .from(capabilityGrants)
    .where(
      and(
        eq(capabilityGrants.guildId, guildId),
        eq(capabilityGrants.targetType, targetType),
        eq(capabilityGrants.targetId, targetId),
      ),
    )
    .limit(1);

  return row ? { ...row, targetType: row.targetType as CapabilityGrantTargetType } : null;
}

export interface GrantCapabilitiesInput {
  guildId: string;
  targetType: CapabilityGrantTargetType;
  targetId: string;
  capabilities: number;
}

/**
 * 指定targetへのcapability grantを作成/上書きする(同一guild+targetType+targetIdはunique制約により1レコード)。
 * 昇格防止チェック(canGrantCapabilities)は呼び出し側(router)の責務とする。
 */
export async function grantCapabilities(db: Db, input: GrantCapabilitiesInput): Promise<void> {
  const { guildId, targetType, targetId, capabilities } = input;
  await db
    .insert(capabilityGrants)
    .values({ id: randomUUID(), guildId, targetType, targetId, capabilities })
    .onConflictDoUpdate({
      target: [capabilityGrants.guildId, capabilityGrants.targetType, capabilityGrants.targetId],
      set: { capabilities },
    });
}

export interface RevokeCapabilityGrantInput {
  guildId: string;
  targetType: CapabilityGrantTargetType;
  targetId: string;
}

/** 指定targetへのcapability grantを削除する(未付与の場合は何もしない)。 */
export async function revokeCapabilityGrant(db: Db, input: RevokeCapabilityGrantInput): Promise<void> {
  const { guildId, targetType, targetId } = input;
  await db
    .delete(capabilityGrants)
    .where(
      and(
        eq(capabilityGrants.guildId, guildId),
        eq(capabilityGrants.targetType, targetType),
        eq(capabilityGrants.targetId, targetId),
      ),
    );
}
