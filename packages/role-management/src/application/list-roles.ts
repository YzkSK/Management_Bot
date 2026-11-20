import type { GuildRoleList } from "@management-bot/dashboard-access";
import { buildRoleListItems, type RoleListItem } from "../domain/index.js";

export interface ListRolesDeps {
  getGuildRoleList: (guildId: string) => Promise<GuildRoleList | null>;
}

export interface ListRolesResult {
  roles: RoleListItem[];
  /** メンバー数を取得できたか(Discord側のエンドポイントが使えない場合false)。 */
  memberCountsAvailable: boolean;
}

/** guildのロール一覧(Discordのロール順)を返す。Bot未参加・権限不足で取得できなければ空。 */
export async function listRoles(deps: ListRolesDeps, guildId: string): Promise<ListRolesResult> {
  const list = await deps.getGuildRoleList(guildId);
  if (!list) return { roles: [], memberCountsAvailable: false };
  return {
    roles: buildRoleListItems({
      guildId,
      roles: list.roles,
      memberCounts: list.memberCounts,
      botRoleIds: list.botRoleIds,
    }),
    memberCountsAvailable: list.memberCounts !== null,
  };
}
