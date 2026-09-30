import { guilds as guildsTable, type Db } from "@management-bot/db";
import { inArray } from "drizzle-orm";
import type { ManagedGuild } from "./trpc.js";

export interface DiscordUserGuildLike {
  id: string;
  owner: boolean;
  /** ビットフィールドを10進文字列で表す(Discord APIレスポンスの形式)。 */
  permissions: string;
  /** アイコンのハッシュ(Discord APIレスポンスの`icon`)。未設定ならnull。 */
  icon?: string | null;
}

const MANAGE_GUILD = 0x20n;

/** DiscordのCDN上のサーバーアイコンURL。"a_"始まりのハッシュはアニメーション(GIF)。 */
export function buildGuildIconUrl(guildId: string, icon: string | null | undefined): string | null {
  if (!icon) return null;
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.${icon.startsWith("a_") ? "gif" : "png"}?size=64`;
}

/** オーナー、またはDiscordのMANAGE_GUILD権限ビットを持つguildか判定する。 */
export function isManagedGuild(guild: Pick<DiscordUserGuildLike, "owner" | "permissions">): boolean {
  return guild.owner || (BigInt(guild.permissions) & MANAGE_GUILD) === MANAGE_GUILD;
}

/**
 * ユーザーが所属し、かつbotが導入済み(guildsテーブルに存在)のguildを全て返す(issue #199)。
 * 管理者権限(オーナーまたはMANAGE_GUILD)を持たないguildも`isManaged: false`で含める。
 */
export async function listMyGuilds(
  db: Db,
  userGuilds: readonly DiscordUserGuildLike[],
): Promise<readonly ManagedGuild[]> {
  if (userGuilds.length === 0) {
    return [];
  }
  const managedById = new Map(userGuilds.map((guild) => [guild.id, isManagedGuild(guild)]));
  const iconById = new Map(userGuilds.map((guild) => [guild.id, buildGuildIconUrl(guild.id, guild.icon)]));
  const installed = await db
    .select({ id: guildsTable.id, name: guildsTable.name })
    .from(guildsTable)
    .where(inArray(guildsTable.id, [...managedById.keys()]));
  return installed.map((guild) => ({
    ...guild,
    isManaged: managedById.get(guild.id) ?? false,
    iconUrl: iconById.get(guild.id) ?? null,
  }));
}
