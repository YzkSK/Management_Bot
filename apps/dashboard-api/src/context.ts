import type {
  ChannelOption,
  DashboardAccessContext,
  GuildMembership,
  ManagedGuild,
} from "@management-bot/dashboard-access";
import { getSessionAccessToken, listMyGuilds } from "@management-bot/dashboard-access";
import type { Db } from "@management-bot/db";
import type { Context as HonoContext } from "hono";
import { getCookie } from "hono/cookie";
import { fetchUserGuilds } from "./oauth/discord-client.js";
import { SESSION_COOKIE } from "./oauth/routes.js";

/**
 * ギルド在籍確認はDiscord Gateway/APIキャッシュ(bot側)への問い合わせが必要だが、
 * そのRedis/RPC連携はPhase 1以降で機能パッケージと一緒に配線する。
 * Phase 0時点ではダッシュボードapp-routerが空のため実際には呼ばれないが、
 * 未在籍として扱う(null)ことでrequireCapabilityがFORBIDDENに倒すようにし、500化を防ぐ。
 */
async function getGuildMembershipNotImplemented(): Promise<GuildMembership | null> {
  return null;
}

/** getGuildMembershipNotImplemented同様、bot側との連携配線はPhase 1以降。空の選択肢として扱う。 */
async function getGuildChannelsNotImplemented(): Promise<readonly ChannelOption[]> {
  return [];
}

/**
 * ログインユーザー自身のOAuth2アクセストークン(`identify guilds`スコープ)でDiscordの所属guild一覧を取得し、
 * bot導入済み(guildsテーブル)かつ管理者権限を持つものだけに絞り込む。
 * getGuildMembership/getGuildChannelsと異なりbot側RPCを必要としないため、Phase 0時点で実装できる。
 */
function createListMyGuilds(db: Db, sessionId: string | undefined, sessionSecret: string): () => Promise<readonly ManagedGuild[]> {
  return async () => {
    if (!sessionId) {
      return [];
    }
    const accessToken = await getSessionAccessToken(db, sessionId, sessionSecret);
    if (!accessToken) {
      return [];
    }
    const userGuilds = await fetchUserGuilds(accessToken);
    return listMyGuilds(db, userGuilds);
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
): (opts: unknown, c: HonoContext) => Record<string, unknown> {
  return (_opts, c) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    const ctx: DashboardAccessContext = {
      db,
      sessionId,
      getGuildMembership: getGuildMembershipNotImplemented,
      getGuildChannels: getGuildChannelsNotImplemented,
      listMyGuilds: createListMyGuilds(db, sessionId, sessionSecret),
    };
    return ctx as unknown as Record<string, unknown>;
  };
}
