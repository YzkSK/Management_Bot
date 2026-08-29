import { capabilityGrants, type Db } from "@management-bot/db";
import { ALL_CAPABILITIES, isKnownCapabilityMask } from "@management-bot/shared";
import { and, eq, inArray, or } from "drizzle-orm";

export interface ResolveEffectiveCapabilitiesInput {
  guildId: string;
  discordUserId: string;
  isOwner: boolean;
  roleIds: readonly string[];
}

export async function resolveEffectiveCapabilities(
  db: Db,
  { guildId, discordUserId, isOwner, roleIds }: ResolveEffectiveCapabilitiesInput,
): Promise<number> {
  if (isOwner) return ALL_CAPABILITIES;

  // @everyoneロールのIDはDiscordの仕様上guildIdと一致するため、常に検索対象に含める。
  const effectiveRoleIds = [...new Set([guildId, ...roleIds])];

  const targetConditions = [
    and(eq(capabilityGrants.targetType, "user"), eq(capabilityGrants.targetId, discordUserId)),
    and(eq(capabilityGrants.targetType, "role"), inArray(capabilityGrants.targetId, effectiveRoleIds)),
  ];

  const rows = await db
    .select({ capabilities: capabilityGrants.capabilities })
    .from(capabilityGrants)
    .where(and(eq(capabilityGrants.guildId, guildId), or(...targetConditions)));

  return rows.reduce(
    (acc, row) => (isKnownCapabilityMask(row.capabilities) ? acc | row.capabilities : acc),
    0,
  );
}
