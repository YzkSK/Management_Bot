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
import { fetchBotGuildPermissions, fetchGuildChannels, fetchGuildMemberNames } from "./discord/bot-client.js";
import { DiscordTokenInvalidError, fetchUserGuilds, type DiscordUserGuild } from "./oauth/discord-client.js";
import { SESSION_COOKIE } from "./oauth/routes.js";
import { createTtlCache } from "./ttl-cache.js";

/**
 * セッションID単位で「ログインユーザーの所属guild一覧」を短命キャッシュする。同一リクエスト内の
 * 複数procedure(getGuildMembership/listMyGuilds)はもちろん、直後の画面遷移・ポーリングをまたいだ
 * 呼び出しもこのTTL内なら再フェッチしない(issue #99)。
 */
const USER_GUILDS_TTL_MS = 30_000;
const userGuildsCache = createTtlCache<readonly DiscordUserGuild[] | null>(USER_GUILDS_TTL_MS);

/**
 * guildId単位でBotトークン側の問い合わせ(チャンネル一覧・実効権限)を短命キャッシュする。
 * 設定画面表示のたびに同じguildへ何度も問い合わせないようにする(issue #99)。
 */
const GUILD_TTL_MS = 30_000;
const guildChannelsCache = createTtlCache<readonly ChannelOption[]>(GUILD_TTL_MS);
const botPermissionsCache = createTtlCache<bigint>(GUILD_TTL_MS);

function createGetGuildChannels(botToken: string): (guildId: string) => Promise<readonly ChannelOption[]> {
  return (guildId) => guildChannelsCache(guildId, () => fetchGuildChannels(botToken, guildId));
}

/**
 * チャンネルID設定のmutation検証専用。キャッシュ済みのgetGuildChannelsを使うと、
 * Discord上で削除済み・送信不可になったチャンネルでも最大GUILD_TTL_MS秒はDBへ保存できてしまうため、
 * 常に生fetchする(issue #99 codexレビュー対応)。
 */
function createVerifyGuildChannel(botToken: string): (guildId: string, channelId: string) => Promise<boolean> {
  return async (guildId, channelId) => {
    const options = await fetchGuildChannels(botToken, guildId);
    return options.some((option) => option.id === channelId);
  };
}

function createGetBotPermissions(botToken: string): (guildId: string) => Promise<bigint> {
  return (guildId) => botPermissionsCache(guildId, () => fetchBotGuildPermissions(botToken, guildId));
}

function createGetGuildMemberNames(
  botToken: string,
): (guildId: string, userIds: readonly string[]) => Promise<ReadonlyMap<string, string>> {
  return (guildId, userIds) => fetchGuildMemberNames(botToken, guildId, userIds);
}

/**
 * ログインユーザー自身のOAuth2アクセストークン(`identify guilds`スコープ)でDiscordの所属guild一覧を取得する。
 * セッション切れ・未ログインは空配列/nullに倒し、Discord側でトークンが失効している場合はUNAUTHORIZEDを投げて
 * フロントの再ログイン導線(AppのisUnauthorizedError)に乗せる。
 * 結果はセッションID単位でuserGuildsCacheに短命TTLキャッシュする(issue #99)。
 */
export async function fetchCurrentUserGuilds(
  db: Db,
  sessionId: string | undefined,
  sessionSecret: string,
): Promise<readonly DiscordUserGuild[] | null> {
  if (!sessionId) {
    return null;
  }
  return userGuildsCache(sessionId, async () => {
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
  });
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
export async function resolveGuildMembership(
  db: Db,
  sessionId: string | undefined,
  sessionSecret: string,
  guildId: string,
): Promise<GuildMembership | null> {
  const userGuilds = await fetchCurrentUserGuilds(db, sessionId, sessionSecret);
  const membership = userGuilds?.find((guild) => guild.id === guildId);
  return membership ? { isOwner: membership.owner, roleIds: [guildId] } : null;
}

function createGetGuildMembership(
  db: Db,
  sessionId: string | undefined,
  sessionSecret: string,
): (guildId: string) => Promise<GuildMembership | null> {
  return (guildId) => resolveGuildMembership(db, sessionId, sessionSecret, guildId);
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
  discordClientId: string,
): (opts: unknown, c: HonoContext) => Record<string, unknown> {
  return (_opts, c) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    const ctx: DashboardAccessContext = {
      db,
      sessionId,
      discordClientId,
      getGuildMembership: createGetGuildMembership(db, sessionId, sessionSecret),
      getGuildChannels: createGetGuildChannels(botToken),
      verifyGuildChannel: createVerifyGuildChannel(botToken),
      getGuildMemberNames: createGetGuildMemberNames(botToken),
      getBotPermissions: createGetBotPermissions(botToken),
      listMyGuilds: createListMyGuilds(db, sessionId, sessionSecret),
    };
    return ctx as unknown as Record<string, unknown>;
  };
}
