const VIEW_CHANNEL = 0x400n;
const SEND_MESSAGES = 0x800n;
const ADMINISTRATOR = 0x8n;
const REQUIRED_TO_SEND = VIEW_CHANNEL | SEND_MESSAGES;

export interface PermissionOverwrite {
  id: string;
  /** 0: ロール, 1: メンバー(discord.jsのOverwriteType)。 */
  type: 0 | 1;
  allow: bigint;
  deny: bigint;
}

export interface RolePermission {
  id: string;
  permissions: bigint;
}

/**
 * Botがそのチャンネルにメッセージを送信できるかを、Discordの権限解決順序
 * (base→@everyone overwrite→ロールoverwrite→メンバーoverwrite、ADMINISTRATORは無条件許可)で計算する。
 */
export function isChannelSendable(input: {
  guildId: string;
  botUserId: string;
  botRoleIds: readonly string[];
  guildRoles: readonly RolePermission[];
  overwrites: readonly PermissionOverwrite[];
}): boolean {
  const roleById = new Map(input.guildRoles.map((role) => [role.id, role.permissions]));
  const everyonePermissions = roleById.get(input.guildId) ?? 0n;
  const botRolePermissions = input.botRoleIds.reduce((acc, roleId) => acc | (roleById.get(roleId) ?? 0n), 0n);
  let permissions = everyonePermissions | botRolePermissions;

  if ((permissions & ADMINISTRATOR) === ADMINISTRATOR) {
    return true;
  }

  const everyoneOverwrite = input.overwrites.find((o) => o.type === 0 && o.id === input.guildId);
  if (everyoneOverwrite) {
    permissions = (permissions & ~everyoneOverwrite.deny) | everyoneOverwrite.allow;
  }

  const roleOverwrites = input.overwrites.filter((o) => o.type === 0 && input.botRoleIds.includes(o.id));
  const roleDeny = roleOverwrites.reduce((acc, o) => acc | o.deny, 0n);
  const roleAllow = roleOverwrites.reduce((acc, o) => acc | o.allow, 0n);
  permissions = (permissions & ~roleDeny) | roleAllow;

  const memberOverwrite = input.overwrites.find((o) => o.type === 1 && o.id === input.botUserId);
  if (memberOverwrite) {
    permissions = (permissions & ~memberOverwrite.deny) | memberOverwrite.allow;
  }

  return (permissions & REQUIRED_TO_SEND) === REQUIRED_TO_SEND;
}
