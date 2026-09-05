import type {
  ChannelOption,
  DashboardAccessContext,
  GuildMembership,
  ManagedGuild,
} from "@management-bot/dashboard-access";
import { getSessionAccessToken, listMyGuilds } from "@management-bot/dashboard-access";
import type { Db } from "@management-bot/db";
import { TRPCError } from "@trpc/server";
import type { Context as HonoContext } from "hono";
import { getCookie } from "hono/cookie";
import { fetchGuildChannels } from "./discord/bot-client.js";
import { DiscordTokenInvalidError, fetchUserGuilds, type DiscordUserGuild } from "./oauth/discord-client.js";
import { SESSION_COOKIE } from "./oauth/routes.js";

function createGetGuildChannels(botToken: string): (guildId: string) => Promise<readonly ChannelOption[]> {
  return (guildId) => fetchGuildChannels(botToken, guildId);
}

/**
 * ログインユーザー自身のOAuth2アクセストークン(`identify guilds`スコープ)でDiscordの所属guild一覧を取得する。
 * セッション切れ・未ログインは空配列/nullに倒し、Discord側でトークンが失効している場合はUNAUTHORIZEDを投げて
 * フロントの再ログイン導線(AppのisUnauthorizedError)に乗せる。
 * ponytail: リクエストごとにDiscord APIへ問い合わせておりキャッシュしない。ログ一覧のポーリング等で
 * レート制限に触れるようならセッション単位の短命キャッシュを追加すること。
 */
async function fetchCurrentUserGuilds(
  db: Db,
  sessionId: string | undefined,
  sessionSecret: string,
): Promise<readonly DiscordUserGuild[] | null> {
  if (!sessionId) {
    return null;
  }
  const accessToken = await getSessionAccessToken(db, sessionId, sessionSecret);
  if (!accessToken) {
    return null;
  }
  try {
    return await fetchUserGuilds(accessToken);
  } catch (error) {
    if (error instanceof DiscordTokenInvalidError) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    throw error;
  }
}

function createListMyGuilds(
  db: Db,
  sessionId: string | undefined,
  sessionSecret: string,
): () => Promise<readonly ManagedGuild[]> {
  return async () => {
    const userGuilds = await fetchCurrentUserGuilds(db, sessionId, sessionSecret);
    return userGuilds ? listMyGuilds(db, userGuilds) : [];
  };
}

/**
 * ダッシュボードの独自capability(VIEW_LOGS等)は、onboardGuild時に発行される
 * オーナー(全capability)と@everyone(roleId===guildId、閲覧系ベースライン)の2種類の
 * capabilityGrantに基づく。Discord本来のロール一覧までは取得しない(`guilds.members.read`
 * スコープの追加同意が必要になるため)ので、実在確認できたguildについては
 * 「オーナーかどうか」と「@everyoneロール(=在籍者全員)」のみを返す簡易実装とする。
 * ponytail: 独自にcapability grantを個別付与されたユーザーの実ロールまでは反映しない。
 * 必要になったら`guilds.members.read`スコープを追加してDiscordのロールIDを取得する。
 */
function createGetGuildMembership(
  db: Db,
  sessionId: string | undefined,
  sessionSecret: string,
): (guildId: string) => Promise<GuildMembership | null> {
  return async (guildId) => {
    const userGuilds = await fetchCurrentUserGuilds(db, sessionId, sessionSecret);
    const membership = userGuilds?.find((guild) => guild.id === guildId);
    return membership ? { isOwner: membership.owner, roleIds: [guildId] } : null;
  };
}

/**
 * `@hono/trpc-server`のcreateContext型は`Record<string, unknown>`を要求するが、
 * 実際にはinitTRPC.context<DashboardAccessContext>()で定義した型がそのままprocedureに渡る。
 * ここでの型注釈はtRPC側の実際の契約(DashboardAccessContext)を守るための意図的なもの。
 */
export function createContext(
  db: Db,
  sessionSecret: string,
  botToken: string,
): (opts: unknown, c: HonoContext) => Record<string, unknown> {
  return (_opts, c) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    const ctx: DashboardAccessContext = {
      db,
      sessionId,
      getGuildMembership: createGetGuildMembership(db, sessionId, sessionSecret),
      getGuildChannels: createGetGuildChannels(botToken),
      listMyGuilds: createListMyGuilds(db, sessionId, sessionSecret),
    };
    return ctx as unknown as Record<string, unknown>;
  };
}
