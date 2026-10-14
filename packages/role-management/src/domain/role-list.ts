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

/** ロール階層の比較(正ならaが上)。Discordは同じpositionのロールをidが小さい方を上として扱う。 */
function compareHierarchy(a: { id: string; position: number }, b: { id: string; position: number }): number {
  return a.position - b.position || compareSnowflake(b.id, a.id);
}

/** Discordのロール順(position降順、同順位はid昇順)に並べ、画面表示用の属性を付与する。 */
export function buildRoleListItems(input: BuildRoleListItemsInput): RoleListItem[] {
  const { guildId, roles, memberCounts, botRoleIds } = input;
  const botRoleIdSet = new Set(botRoleIds);
  const botTopRole = roles
    .filter((role) => botRoleIdSet.has(role.id))
    .reduce<RoleListSourceRole | null>((top, role) => (!top || compareHierarchy(role, top) > 0 ? role : top), null);

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
        botManageable: !role.managed && !isEveryone && botTopRole !== null && compareHierarchy(role, botTopRole) < 0,
      };
    })
    .sort((a, b) => compareHierarchy(b, a));
}
