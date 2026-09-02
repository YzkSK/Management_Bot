import type { FeatureModuleContext } from "@management-bot/core";
import type { GuildMember, PartialGuildMember, Role } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import type { WriteLogEntryDeps } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";
import { writeLogEntrySafely } from "../write-log-entry-safely.js";

export function toRoleCreateLogEntry(role: Role): LogEntry {
  return { category: "role", guildId: role.guild.id, createdAt: new Date().toISOString(), roleId: role.id, action: "create" };
}

export function toRoleUpdateLogEntry(_oldRole: Role, newRole: Role): LogEntry {
  return { category: "role", guildId: newRole.guild.id, createdAt: new Date().toISOString(), roleId: newRole.id, action: "update" };
}

export function toRoleDeleteLogEntry(role: Role): LogEntry {
  return { category: "role", guildId: role.guild.id, createdAt: new Date().toISOString(), roleId: role.id, action: "delete" };
}

/** guildMemberUpdateでのロール差分を、付与ロールごとにmemberAdd、剥奪ロールごとにmemberRemoveとして返す。 */
export function toRoleMembershipLogEntries(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember): LogEntry[] {
  const createdAt = new Date().toISOString();
  const guildId = newMember.guild.id;
  const oldRoleIds = new Set(oldMember.roles.cache.keys());
  const newRoleIds = new Set(newMember.roles.cache.keys());

  const entries: LogEntry[] = [];
  for (const roleId of newRoleIds) {
    if (!oldRoleIds.has(roleId)) entries.push({ category: "role", guildId, createdAt, roleId, action: "memberAdd" });
  }
  for (const roleId of oldRoleIds) {
    if (!newRoleIds.has(roleId)) entries.push({ category: "role", guildId, createdAt, roleId, action: "memberRemove" });
  }
  return entries;
}

export function registerRoleHandlers(ctx: FeatureModuleContext): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx) };

  ctx.client.on("roleCreate", (role) => writeLogEntrySafely(deps, toRoleCreateLogEntry(role)));
  ctx.client.on("roleUpdate", (oldRole, newRole) => writeLogEntrySafely(deps, toRoleUpdateLogEntry(oldRole, newRole)));
  ctx.client.on("roleDelete", (role) => writeLogEntrySafely(deps, toRoleDeleteLogEntry(role)));
  ctx.client.on("guildMemberUpdate", (oldMember, newMember) => {
    for (const entry of toRoleMembershipLogEntries(oldMember, newMember)) {
      writeLogEntrySafely(deps, entry);
    }
  });
}
