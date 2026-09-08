import type { FeatureModuleContext } from "@management-bot/core";
import type { GuildMember, PartialGuildMember, Role } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import type { GetChannelId, WriteLogEntryDeps } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";
import { writeLogEntrySafely } from "../write-log-entry-safely.js";

export function toRoleCreateLogEntry(role: Role): LogEntry {
  return { category: "role", guildId: role.guild.id, createdAt: new Date().toISOString(), roleId: role.id, action: "create" };
}

/**
 * positionは対象外: ロールの並び替えでは移動させた本人以外の複数ロールでも
 * positionが実際に変わりroleUpdateが発火するため、追跡対象にすると
 * 「無関係なロールへの波及を記録しない」というこの修正の目的が再び壊れる。
 */
const TRACKED_ROLE_FIELDS = ["name", "color", "hoist", "mentionable", "permissions"] as const;

function getTrackedRoleValue(role: Role, field: (typeof TRACKED_ROLE_FIELDS)[number]): string | number | boolean {
  if (field === "permissions") return role.permissions.bitfield.toString();
  return role[field];
}

/** oldRoleとnewRoleを比較し、実際に変化したフィールドのみをchangesに含める。無関係なロールへの波及等で差分がなければnullを返す。 */
export function toRoleUpdateLogEntry(oldRole: Role, newRole: Role): LogEntry | null {
  const changes: Record<string, { before: string | number | boolean; after: string | number | boolean }> = {};
  for (const field of TRACKED_ROLE_FIELDS) {
    const before = getTrackedRoleValue(oldRole, field);
    const after = getTrackedRoleValue(newRole, field);
    if (before !== after) changes[field] = { before, after };
  }
  if (Object.keys(changes).length === 0) return null;
  return { category: "role", guildId: newRole.guild.id, createdAt: new Date().toISOString(), roleId: newRole.id, action: "update", changes };
}

export function toRoleDeleteLogEntry(role: Role): LogEntry {
  return { category: "role", guildId: role.guild.id, createdAt: new Date().toISOString(), roleId: role.id, action: "delete" };
}

/**
 * guildMemberUpdateでのロール差分を、付与ロールごとにmemberAdd、剥奪ロールごとにmemberRemoveとして返す(対象メンバーはuserIdに入れる)。
 * ponytail: oldMember.roles.cacheがキャッシュ不完全な状態(再起動直後等)で呼ばれると
 * 実際には変化していないロールを誤ってmemberAdd/memberRemoveとして記録し得る。
 * discord.jsのGuildMember.partialは常にfalseで判別に使えず、有効な検出手段がないため許容する。
 * 改善するならGUILD_MEMBERS intentのキャッシュ完了(readyまでの待機)を保証する仕組みを追加する。
 */
export function toRoleMembershipLogEntries(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember): LogEntry[] {
  const createdAt = new Date().toISOString();
  const guildId = newMember.guild.id;
  const userId = newMember.id;
  const oldRoleIds = new Set(oldMember.roles.cache.keys());
  const newRoleIds = new Set(newMember.roles.cache.keys());

  const entries: LogEntry[] = [];
  for (const roleId of newRoleIds) {
    if (!oldRoleIds.has(roleId)) entries.push({ category: "role", guildId, createdAt, roleId, userId, action: "memberAdd" });
  }
  for (const roleId of oldRoleIds) {
    if (!newRoleIds.has(roleId)) entries.push({ category: "role", guildId, createdAt, roleId, userId, action: "memberRemove" });
  }
  return entries;
}

export function registerRoleHandlers(ctx: FeatureModuleContext, getChannelId: GetChannelId): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx), getChannelId };

  ctx.client.on("roleCreate", (role) => writeLogEntrySafely(deps, toRoleCreateLogEntry(role)));
  ctx.client.on("roleUpdate", (oldRole, newRole) => {
    const entry = toRoleUpdateLogEntry(oldRole, newRole);
    if (entry) writeLogEntrySafely(deps, entry);
  });
  ctx.client.on("roleDelete", (role) => writeLogEntrySafely(deps, toRoleDeleteLogEntry(role)));
  ctx.client.on("guildMemberUpdate", (oldMember, newMember) => {
    for (const entry of toRoleMembershipLogEntries(oldMember, newMember)) {
      writeLogEntrySafely(deps, entry);
    }
  });
}
