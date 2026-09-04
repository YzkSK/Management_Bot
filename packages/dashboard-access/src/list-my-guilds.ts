import { guilds as guildsTable, type Db } from "@management-bot/db";
import { inArray } from "drizzle-orm";
import type { ManagedGuild } from "./trpc.js";

export interface DiscordUserGuildLike {
  id: string;
  owner: boolean;
  /** ビットフィールドを10進文字列で表す(Discord APIレスポンスの形式)。 */
  permissions: string;
}

const MANAGE_GUILD = 0x20n;

/** オーナー、またはDiscordのMANAGE_GUILD権限ビットを持つguildか判定する。 */
export function isManagedGuild(guild: Pick<DiscordUserGuildLike, "owner" | "permissions">): boolean {
  return guild.owner || (BigInt(guild.permissions) & MANAGE_GUILD) === MANAGE_GUILD;
}

/** ユーザーが管理者権限を持ち、かつbotが導入済み(guildsテーブルに存在)のguildだけを返す。 */
export async function listMyGuilds(
  db: Db,
  userGuilds: readonly DiscordUserGuildLike[],
): Promise<readonly ManagedGuild[]> {
  const managedIds = userGuilds.filter(isManagedGuild).map((guild) => guild.id);
  if (managedIds.length === 0) {
    return [];
  }
  return db
    .select({ id: guildsTable.id, name: guildsTable.name })
    .from(guildsTable)
    .where(inArray(guildsTable.id, managedIds));
}
