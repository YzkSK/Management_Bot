import type {
  ChannelOption,
  DashboardAccessContext,
  GuildAccessStatus,
  GuildMembership,
  ManagedGuild,
  MemberPage,
  ResolveEffectiveCapabilitiesInput,
  RoleOption,
} from "@management-bot/dashboard-access";
import {
  getSessionAccessToken,
  listMyGuilds,
  resolveEffectiveCapabilities,
} from "@management-bot/dashboard-access";
import type { Db } from "@management-bot/db";
import { createTtlCache } from "@management-bot/shared";
import { TRPCError } from "@trpc/server";
import type { Context as HonoContext } from "hono";
import { getCookie } from "hono/cookie";
import {
  fetchAllGuildChannelNames,
  fetchBotGuildPermissions,
  fetchGuildAccessStatus,
  fetchGuildChannels,
  fetchGuildMemberNames,
  fetchGuildMemberRoleIds,
  fetchGuildMembersPage,
  fetchGuildRoles,
  isGuildMember,
  verifyGuildRole,
} from "./discord/bot-client.js";
import {
  buildAvatarUrl,
  DiscordTokenInvalidError,
  fetchDiscordUser,
  fetchUserGuilds,
  type DiscordUserGuild,
} from "./oauth/discord-client.js";
import { SESSION_COOKIE } from "./oauth/routes.js";

/**
 * セッションID単位で「ログインユーザーの所属guild一覧」を短命キャッシュする。同一リクエスト内の
 * 複数procedure(getGuildMembership/listMyGuilds)はもちろん、直後の画面遷移・ポーリングをまたいだ
 * 呼び出しもこのTTL内なら再フェッチしない(issue #99)。
 */
const USER_GUILDS_TTL_MS = 30_000;
const userGuildsCache = createTtlCache<readonly DiscordUserGuild[] | null>(USER_GUILDS_TTL_MS);

/**
 * セッションID単位でDiscordアバターURLを短命キャッシュする。ヘッダー描画のたびにDiscord APIへ
 * 問い合わせないようにする(issue #265。userGuildsCacheと同じ考え方)。
 */
const AVATAR_URL_TTL_MS = 30_000;
const avatarUrlCache = createTtlCache<string | null>(AVATAR_URL_TTL_MS);

/**
 * guildId単位でBotトークン側の問い合わせ(チャンネル一覧・実効権限)を短命キャッシュする。
 * 設定画面表示のたびに同じguildへ何度も問い合わせないようにする(issue #99)。
 */
const GUILD_TTL_MS = 30_000;
const guildChannelsCache = createTtlCache<readonly ChannelOption[]>(GUILD_TTL_MS);
const allGuildChannelsCache = createTtlCache<readonly ChannelOption[]>(GUILD_TTL_MS);
const botPermissionsCache = createTtlCache<bigint>(GUILD_TTL_MS);
const guildRolesCache = createTtlCache<readonly RoleOption[]>(GUILD_TTL_MS);
const guildAccessStatusCache = createTtlCache<GuildAccessStatus>(GUILD_TTL_MS);
/** キーは`${guildId}:${after}`(ページ単位)。 */
const guildMembersPageCache = createTtlCache<MemberPage>(GUILD_TTL_MS);
/**
 * fetchGuildMembersPageの1000人上限に含まれない個別フォールバック解決分をuserId単位でキャッシュする。
 * ログ一覧表示のたびに含まれる実行者IDの数だけDiscord APIへ個別問い合わせが発生していたため(issue #221)。
 * キーは`${guildId}:${userId}`。
 */
const guildMemberNameCache = createTtlCache<string | undefined>(GUILD_TTL_MS);

/**
 * requireCapabilityミドルウェアはprocedureごとにgetGuildMembershipを呼ぶため、
 * 1画面が複数procedureを呼ぶ場合(例: AccessPageはlistCapabilityGrants/getMyCapabilities/
 * listRoleOptions/listMemberOptions/resolveTargetUserNamesの最低5つ)、同一リクエストバッチ内で
 * 同じguildId+discordUserIdへのBot API問い合わせ(/guilds/{id}/members/{userId})が直列に
 * 重複発生し表示が遅くなる。認可のリアルタイム性(capability剥奪直後の反映)を大きく損なわない
 * 数秒程度の短命TTLで、同一バッチ内の重複排除のみを目的にキャッシュする。
 */
const GUILD_MEMBERSHIP_TTL_MS = 5_000;
const guildMembershipCache = createTtlCache<GuildMembership | null>(GUILD_MEMBERSHIP_TTL_MS);

/**
 * requireCapabilityミドルウェアはprocedureごとにresolveEffectiveCapabilities(DB SELECT)も
 * 呼ぶため、guildMembershipCacheと同じ理由でAccessPageのような1画面複数procedureの場合に
 * 重複問い合わせが起きる。ただしgrant/revokeCapabilityGrantはこのDBの内容そのものを直接
 * 書き換えるmutationであり、モジュールスコープのTTLキャッシュにすると剥奪した権限が最大TTL秒
 * 別リクエストでも有効になってしまい昇格防止の前提を壊す(codexレビュー対応)。そのため
 * guildMembershipCacheのようなプロセス全体で共有するキャッシュにはせず、createContext呼び出し
 * (=1 HTTPリクエスト=1 tRPCバッチ)ごとに新しいキャッシュを生成し、同一バッチ内のin-flight
 * 重複排除のみを行う(バッチをまたいでは共有しない)。
 */
export function createResolveEffectiveCapabilities(
  db: Db,
  resolve: (input: ResolveEffectiveCapabilitiesInput) => Promise<number> = (input) =>
    resolveEffectiveCapabilities(db, input),
): (input: ResolveEffectiveCapabilitiesInput) => Promise<number> {
  const inFlight = new Map<string, Promise<number>>();
  return (input) => {
    const key = `${input.guildId}:${input.discordUserId}:${input.isOwner}:${[...input.roleIds].sort().join(",")}`;
    const cached = inFlight.get(key);
    if (cached) {
      return cached;
    }
    // 完了後(成功・失敗いずれも)はMapから外す。in-flightの重複排除のみが目的で、
    // 完了済みの結果や例外を再利用する結果キャッシュにはしない(同一バッチ内の後続
    // procedureが一時的なDBエラーを再試行できるようにするため)。
    const value = resolve(input).finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, value);
    return value;
  };
}

function createGetGuildChannels(botToken: string): (guildId: string) => Promise<readonly ChannelOption[]> {
  return (guildId) => guildChannelsCache(guildId, () => fetchGuildChannels(botToken, guildId));
}

function createGetAllGuildChannels(botToken: string): (guildId: string) => Promise<readonly ChannelOption[]> {
  return (guildId) => allGuildChannelsCache(guildId, () => fetchAllGuildChannelNames(botToken, guildId));
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

/**
 * チャンネル/ロールセレクター・監査ログ権限表示が空/0nを返した理由(Bot権限不足かguild未参加か)を
 * UIへ伝えるための状態取得(issue #214)。表示専用なのでgetGuildChannels等と同じ短命TTLで
 * キャッシュしてよい。
 */
function createGetGuildAccessStatus(botToken: string): (guildId: string) => Promise<GuildAccessStatus> {
  return (guildId) => guildAccessStatusCache(guildId, () => fetchGuildAccessStatus(botToken, guildId));
}

function createGetGuildRoles(botToken: string): (guildId: string) => Promise<readonly RoleOption[]> {
  return (guildId) => guildRolesCache(guildId, () => fetchGuildRoles(botToken, guildId));
}

function createVerifyGuildRole(botToken: string): (guildId: string, roleId: string) => Promise<boolean> {
  return (guildId, roleId) => verifyGuildRole(botToken, guildId, roleId);
}

function createGetGuildMembersPage(
  botToken: string,
): (guildId: string, after?: string) => Promise<MemberPage> {
  return (guildId, after = "0") =>
    guildMembersPageCache(`${guildId}:${after}`, () => fetchGuildMembersPage(botToken, guildId, after));
}

/**
 * targetId実在検証専用(issue #198)。表示用キャッシュを介さず常にBot APIへ問い合わせる
 * (脱退直後のユーザーへの誤付与を防ぐため。verifyGuildChannelと同じ考え方)。
 */
function createIsGuildMember(botToken: string): (guildId: string, userId: string) => Promise<boolean> {
  return (guildId, userId) => isGuildMember(botToken, guildId, userId);
}

export function createGetGuildMemberNamesWith(
  fetchNames: (guildId: string, userIds: readonly string[]) => Promise<ReadonlyMap<string, string>>,
): (guildId: string, userIds: readonly string[]) => Promise<ReadonlyMap<string, string>> {
  return async (guildId, userIds) => {
    const resolved = await Promise.all(
      userIds.map(
        async (userId) =>
          [
            userId,
            await guildMemberNameCache(`${guildId}:${userId}`, async () => {
              const names = await fetchNames(guildId, [userId]);
              return names.get(userId);
            }),
          ] as const,
      ),
    );
    return new Map(resolved.filter((entry): entry is readonly [string, string] => entry[1] !== undefined));
  };
}

function createGetGuildMemberNames(
  botToken: string,
): (guildId: string, userIds: readonly string[]) => Promise<ReadonlyMap<string, string>> {
  return createGetGuildMemberNamesWith((guildId, userIds) => fetchGuildMemberNames(botToken, guildId, userIds));
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

function createGetMyAvatarUrl(
  db: Db,
  sessionId: string | undefined,
  sessionSecret: string,
): () => Promise<string | null> {
  return async () => {
    if (!sessionId) {
      return null;
    }
    return avatarUrlCache(sessionId, async () => {
      const accessToken = await getSessionAccessToken(db, sessionId, sessionSecret);
      if (!accessToken) {
        return null;
      }
      const user = await fetchDiscordUser(accessToken);
      return buildAvatarUrl(user);
    });
  };
}

/**
 * ダッシュボードの独自capability(VIEW_LOGS等)は、onboardGuild時に発行される
 * オーナー(全capability)と@everyone(roleId===guildId、閲覧系ベースライン)の2種類の
 * capabilityGrantに加え、capability付与画面(issue #198)で個別に付与されたuser/role grantに基づく。
 * roleIdsはBotトークン経由でDiscordの実ロールを取得して返す(ユーザーOAuthスコープの追加同意は不要。
 * Botは対象guildに既に参加しているため、`/guilds/{id}/members/{userId}`をBotトークンで問い合わせられる)。
 */
export async function resolveGuildMembership(
  db: Db,
  sessionId: string | undefined,
  sessionSecret: string,
  botToken: string,
  guildId: string,
  discordUserId: string,
): Promise<GuildMembership | null> {
  const userGuilds = await fetchCurrentUserGuilds(db, sessionId, sessionSecret);
  const membership = userGuilds?.find((guild) => guild.id === guildId);
  if (!membership) {
    return null;
  }
  const memberRoleIds = await fetchGuildMemberRoleIds(botToken, guildId, discordUserId);
  if (memberRoleIds === null) {
    return null;
  }
  return { isOwner: membership.owner, roleIds: [guildId, ...memberRoleIds] };
}

export function createGetGuildMembership(
  db: Db,
  sessionId: string | undefined,
  sessionSecret: string,
  botToken: string,
): (guildId: string, discordUserId: string) => Promise<GuildMembership | null> {
  return (guildId, discordUserId) =>
    guildMembershipCache(`${guildId}:${discordUserId}`, () =>
      resolveGuildMembership(db, sessionId, sessionSecret, botToken, guildId, discordUserId),
    );
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
      getGuildMembership: createGetGuildMembership(db, sessionId, sessionSecret, botToken),
      resolveEffectiveCapabilities: createResolveEffectiveCapabilities(db),
      getGuildChannels: createGetGuildChannels(botToken),
      getAllGuildChannels: createGetAllGuildChannels(botToken),
      verifyGuildChannel: createVerifyGuildChannel(botToken),
      getGuildMemberNames: createGetGuildMemberNames(botToken),
      getBotPermissions: createGetBotPermissions(botToken),
      getGuildRoles: createGetGuildRoles(botToken),
      getGuildAccessStatus: createGetGuildAccessStatus(botToken),
      verifyGuildRole: createVerifyGuildRole(botToken),
      getGuildMembersPage: createGetGuildMembersPage(botToken),
      isGuildMember: createIsGuildMember(botToken),
      listMyGuilds: createListMyGuilds(db, sessionId, sessionSecret),
      getMyAvatarUrl: createGetMyAvatarUrl(db, sessionId, sessionSecret),
    };
    return ctx as unknown as Record<string, unknown>;
  };
}
