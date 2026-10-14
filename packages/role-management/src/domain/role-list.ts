export interface RoleListSourceRole {
  id: string;
  name: string;
  color: number;
  position: number;
  permissions: string;
  managed: boolean;
  botId: string | null;
}

export interface RoleListItem {
  id: string;
  name: string;
  color: number;
  position: number;
  /** 権限ビットフィールド(10進文字列)。 */
  permissions: string;
  /** メンバー数。@everyone・メンバー数が取得できない場合はnull。 */
  memberCount: number | null;
  isEveryone: boolean;
  botId: string | null;
  /** Botのロール階層上、Botがこのロールを操作できるか。 */
  botManageable: boolean;
}

export interface BuildRoleListItemsInput {
  guildId: string;
  roles: readonly RoleListSourceRole[];
  memberCounts: Readonly<Record<string, number>> | null;
  botRoleIds: readonly string[];
}

/** snowflakeを数値として昇順比較する(桁数→辞書順。bigintに変換しない)。 */
function compareSnowflake(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/** Discordのロール順(position降順、同順位はid昇順)に並べ、画面表示用の属性を付与する。 */
export function buildRoleListItems(input: BuildRoleListItemsInput): RoleListItem[] {
  const { guildId, roles, memberCounts, botRoleIds } = input;
  const botRoleIdSet = new Set(botRoleIds);
  const botTopPosition = roles.reduce(
    (max, role) => (botRoleIdSet.has(role.id) ? Math.max(max, role.position) : max),
    0,
  );

  return roles
    .map((role): RoleListItem => {
      const isEveryone = role.id === guildId;
      return {
        id: role.id,
        name: role.name,
        color: role.color,
        position: role.position,
        permissions: role.permissions,
        memberCount: isEveryone ? null : memberCounts ? (memberCounts[role.id] ?? 0) : null,
        isEveryone,
        botId: role.botId,
        botManageable: !role.managed && !isEveryone && role.position < botTopPosition,
      };
    })
    .sort((a, b) => b.position - a.position || compareSnowflake(a.id, b.id));
}
