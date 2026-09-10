import { z } from "zod";
import type { ChannelOption, MemberOption, RoleOption } from "@management-bot/dashboard-access";
import { isChannelSendable, resolveGuildLevelPermissions } from "./channel-permissions.js";

const DISCORD_API_BASE = "https://discord.com/api/v10";

/** テキストメッセージを送信できるチャンネルタイプ(discord.jsのChannelType定数値)。 */
const TEXT_SENDABLE_CHANNEL_TYPES = new Set([0, 5]); // GuildText, GuildAnnouncement

const bigintString = z.string().regex(/^\d+$/, "must be an unsigned decimal string").transform((v) => BigInt(v));

const overwriteSchema = z.object({
  id: z.string(),
  type: z.union([z.literal(0), z.literal(1)]),
  allow: bigintString,
  deny: bigintString,
});

const guildChannelSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.number(),
  permission_overwrites: z.array(overwriteSchema).default([]),
});

const activeThreadsSchema = z.object({ threads: z.array(guildChannelSchema) });

const guildRoleSchema = z.object({ id: z.string(), name: z.string(), permissions: bigintString });

const guildMemberSchema = z.object({ roles: z.array(z.string()) });

const guildMemberListEntrySchema = z.object({
  user: z.object({ id: z.string(), username: z.string(), global_name: z.string().nullable().optional() }),
  nick: z.string().nullable().optional(),
});

const meSchema = z.object({ id: z.string() });

const guildMemberWithUserSchema = z.object({
  nick: z.string().nullable().optional(),
  user: z.object({
    username: z.string(),
    global_name: z.string().nullable().optional(),
  }),
});

const userSchema = z.object({
  username: z.string(),
  global_name: z.string().nullable().optional(),
});

/**
 * 429時の再試行回数(初回リクエストを含めない)。ログ一覧のユーザー名解決はリクエストが
 * バースト的に集中しやすく、3回では吸収しきれず解決漏れが発生していたため5回に増やした
 * (issue #165)。合計リクエスト数は初回+この回数になる。
 */
const MAX_RATE_LIMIT_RETRIES = 5;

/**
 * 403(権限不足)をguild未参加相当の`not_found`として扱うか、専用エラーとして投げるか。
 * `throw`はguild自体は見つかっているのに特定の操作だけ拒否される場合に使う
 * (issue #198: `/guilds/{id}/members`はGUILD_MEMBERS Privileged Intent未設定でも403になり、
 * 「メンバー0人」と誤認させないため区別する)。
 */
type ForbiddenHandling = "treat-as-not-found" | "throw";

/** 403を`throw`扱いにしたdiscordGetが投げる、Bot権限・Intent不足を示すエラー。 */
export class DiscordAccessForbiddenError extends Error {
  constructor(path: string) {
    super(`Discord API access forbidden (${path}): check bot permissions/privileged intents`);
    this.name = "DiscordAccessForbiddenError";
  }
}

async function discordGet<T>(
  botToken: string,
  path: string,
  schema: z.ZodType<T>,
  onForbidden: ForbiddenHandling = "treat-as-not-found",
): Promise<T | "not_found"> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${DISCORD_API_BASE}${path}`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    if (response.status === 403 && onForbidden === "throw") {
      throw new DiscordAccessForbiddenError(path);
    }
    if (response.status === 403 || response.status === 404) {
      return "not_found";
    }
    if (response.status === 429) {
      const willRetry = attempt < MAX_RATE_LIMIT_RETRIES;
      const retryAfterSeconds = Number(response.headers.get("Retry-After"));
      const delayMs = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : 1000;
      // Dashboardの体感遅延がレート制限のリトライ待ちによるものか判断するための観測用ログ(issue #211)。
      // リトライ上限に到達した最終試行も、原因調査から漏れないよう記録する。
      console.warn(
        willRetry
          ? `Discord API rate limited (${path}): retry ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES} after ${delayMs}ms`
          : `Discord API rate limited (${path}): retry limit reached, giving up`,
      );
      if (willRetry) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
    }
    if (!response.ok) {
      throw new Error(`Discord API request failed (${path}): ${response.status}`);
    }
    return schema.parse(await response.json());
  }
}

/**
 * `/users/@me`はBotトークンに対して不変(Bot自身のuser id)なので、トークンごとに一度取得した
 * 結果を使い回す。fetchGuildChannels/fetchBotGuildPermissionsの直列往復を1本減らす
 * (issue #99)。
 */
const meCache = new Map<string, Promise<z.infer<typeof meSchema> | "not_found">>();

function getMe(botToken: string): Promise<z.infer<typeof meSchema> | "not_found"> {
  let cached = meCache.get(botToken);
  if (!cached) {
    cached = discordGet(botToken, "/users/@me", meSchema);
    cached.catch((error: unknown) => {
      console.error("Failed to fetch /users/@me", error);
      meCache.delete(botToken);
    });
    meCache.set(botToken, cached);
  }
  return cached;
}

/**
 * Botトークンでguild直下の全チャンネルを取得し、Botが実際にメッセージを送信できるチャンネルだけに絞り込む。
 * (チャンネル種別に加え、guildロール・チャンネルのpermission overwriteから送信権限を計算する。)
 * guildが見つからない/Botが未参加(403/404)の場合は空配列を返す。
 */
export async function fetchGuildChannels(botToken: string, guildId: string): Promise<readonly ChannelOption[]> {
  const [me, channels, roles] = await Promise.all([
    getMe(botToken),
    discordGet(botToken, `/guilds/${guildId}/channels`, z.array(guildChannelSchema)),
    discordGet(botToken, `/guilds/${guildId}/roles`, z.array(guildRoleSchema)),
  ]);
  if (me === "not_found" || channels === "not_found" || roles === "not_found") {
    return [];
  }

  const member = await discordGet(botToken, `/guilds/${guildId}/members/${me.id}`, guildMemberSchema);
  if (member === "not_found") {
    return [];
  }

  return channels
    .filter((channel) => TEXT_SENDABLE_CHANNEL_TYPES.has(channel.type))
    .filter((channel) =>
      isChannelSendable({
        guildId,
        botUserId: me.id,
        botRoleIds: member.roles,
        guildRoles: roles,
        overwrites: channel.permission_overwrites,
      }),
    )
    .map((channel) => ({ id: channel.id, name: channel.name }));
}

/**
 * guild直下の全チャンネル(種別・送信可否を問わない)とアクティブなスレッドのid/nameを返す。表示名解決専用
 * (issue #144: fetchGuildChannelsはテキスト送信可能チャンネルのみに絞るため、ボイスチャンネル等の
 * ログでチャンネル名が解決できずIDのまま表示されてしまう問題への対応)。
 * スレッドは`/guilds/{id}/channels`に含まれないため`/guilds/{id}/threads/active`を別途取得する
 * (issue #155: threadログで「スレッド」固定文言ではなくスレッド名を表示するため)。
 * アーカイブ済みスレッドはこのエンドポイントに含まれず、IDのままフォールバック表示される。
 * guildが見つからない/Botが未参加(403/404)の場合は空配列を返す。
 * チャンネル本体・スレッドいずれの取得失敗(5xx等)も表示名解決全体を巻き込まないよう、
 * 空配列にdegradeする(issue #157: resolveDisplayNamesが一時的なDiscord API障害で500になる問題)。
 */
export async function fetchAllGuildChannelNames(
  botToken: string,
  guildId: string,
): Promise<readonly ChannelOption[]> {
  const [channels, activeThreads] = await Promise.all([
    discordGet(botToken, `/guilds/${guildId}/channels`, z.array(guildChannelSchema)).catch((error: unknown) => {
      console.error(`Failed to fetch channels for guild ${guildId}`, error);
      return "not_found" as const;
    }),
    discordGet(botToken, `/guilds/${guildId}/threads/active`, activeThreadsSchema).catch((error: unknown) => {
      console.error(`Failed to fetch active threads for guild ${guildId}`, error);
      return "not_found" as const;
    }),
  ]);
  if (channels === "not_found") {
    return [];
  }
  const threads = activeThreads === "not_found" ? [] : activeThreads.threads;
  return [...channels, ...threads].map((channel) => ({ id: channel.id, name: channel.name }));
}

/**
 * Botがそのguildで持つ実効権限(guildロールのpermissionsのOR合成、チャンネルoverwriteは含まない)を返す。
 * ViewAuditLog等、チャンネル単位のoverwriteが存在しない権限の判定に使う
 * (issue #80: integration/auditLogCorrelationがguildAuditLogEntryCreateイベントに依存するため)。
 * Bot未参加/guild不明(403/404)の場合は0nを返す。
 */
export async function fetchBotGuildPermissions(botToken: string, guildId: string): Promise<bigint> {
  const [me, roles] = await Promise.all([
    getMe(botToken),
    discordGet(botToken, `/guilds/${guildId}/roles`, z.array(guildRoleSchema)),
  ]);
  if (me === "not_found" || roles === "not_found") {
    return 0n;
  }

  const member = await discordGet(botToken, `/guilds/${guildId}/members/${me.id}`, guildMemberSchema);
  if (member === "not_found") {
    return 0n;
  }

  return resolveGuildLevelPermissions({ guildId, botRoleIds: member.roles, guildRoles: roles });
}

/**
 * guild直下の全ロールのid/nameを返す。capability付与画面のロールセレクター用
 * (issue #198)。guildが見つからない/Botが未参加(403/404)の場合は空配列を返す。
 * (Discordのguildあたりロール数上限は250件であり、チャンネル一覧同様ページングは不要。)
 */
export async function fetchGuildRoles(botToken: string, guildId: string): Promise<readonly RoleOption[]> {
  const roles = await discordGet(botToken, `/guilds/${guildId}/roles`, z.array(guildRoleSchema));
  if (roles === "not_found") {
    return [];
  }
  return roles.map((role) => ({ id: role.id, name: role.name }));
}

/**
 * capability grantのtargetId実在検証専用(issue #198)。Bot脱退・権限異常による403を
 * 「roleが存在しない」と誤診しないよう、fetchGuildRolesとは異なり403を例外として投げる
 * (isGuildMemberと同じfail-closedの考え方)。guild不明(404)はfalseを返す。
 */
export async function verifyGuildRole(botToken: string, guildId: string, roleId: string): Promise<boolean> {
  const roles = await discordGet(botToken, `/guilds/${guildId}/roles`, z.array(guildRoleSchema), "throw");
  return roles !== "not_found" && roles.some((role) => role.id === roleId);
}

/**
 * guild内の指定ユーザーが持つロールID一覧を返す(`@everyone`は含まない、Discord APIの仕様通り)。
 * capability grantの実効capabilities計算(resolveEffectiveCapabilitiesのroleIds)で、role単位の
 * grantをDashboardの認可に反映するために使う(issue #198)。ユーザーOAuthスコープの追加同意なしに
 * Botトークンのみで取得できる。
 * guild不明/ユーザー未在籍(404)はnullを返す(呼び出し側はguild未所属として扱うこと)。
 * Bot未参加等の403は、実際には在籍しているユーザーの権限を「ロールなし」と誤って
 * fail-openさせないよう例外として投げる(issue #198 codexレビュー対応)。
 */
export async function fetchGuildMemberRoleIds(
  botToken: string,
  guildId: string,
  userId: string,
): Promise<readonly string[] | null> {
  const member = await discordGet(botToken, `/guilds/${guildId}/members/${userId}`, guildMemberSchema, "throw");
  if (member === "not_found") {
    return null;
  }
  return member.roles;
}

/** guild内に指定ユーザーが実在(在籍)するかを判定する。capability grantのtargetId検証用(issue #198)。 */
export async function isGuildMember(botToken: string, guildId: string, userId: string): Promise<boolean> {
  return (await fetchGuildMemberRoleIds(botToken, guildId, userId)) !== null;
}

/** 1ページあたりに取得するguildメンバー数(Discord APIの`/guilds/{id}/members`が許容する最大値)。 */
const MEMBER_LIST_PAGE_SIZE = 1000;

export interface MemberPage {
  members: readonly MemberOption[];
  /** 次ページ取得用のuser id(昇順カーソル)。undefinedなら最終ページ。 */
  nextAfter: string | undefined;
}

/**
 * guild直下のメンバーをuser id昇順で1ページ分(最大MEMBER_LIST_PAGE_SIZE件)取得する。
 * capability付与画面のユーザーセレクター用(issue #198)。大規模guildで全件を一度にメモリへ
 * 積まないよう、呼び出し側がnextAfterで明示的にページ送りする設計にしている。
 * guild不明(404)の場合は空ページを返す。GUILD_MEMBERS Privileged Intent未設定による403は
 * 「メンバー0人」と誤認させないためDiscordAccessForbiddenErrorとして投げる。
 */
export async function fetchGuildMembersPage(
  botToken: string,
  guildId: string,
  after = "0",
): Promise<MemberPage> {
  const page = await discordGet(
    botToken,
    `/guilds/${guildId}/members?limit=${MEMBER_LIST_PAGE_SIZE}&after=${after}`,
    z.array(guildMemberListEntrySchema),
    "throw",
  );
  if (page === "not_found") {
    return { members: [], nextAfter: undefined };
  }
  return {
    members: page.map((member) => ({
      id: member.user.id,
      name: member.nick || member.user.global_name || member.user.username,
    })),
    nextAfter: page.length === MEMBER_LIST_PAGE_SIZE ? page[page.length - 1]!.user.id : undefined,
  };
}

/**
 * Discordのグローバルレート制限(bot全体で概ね50 req/秒)に対し、ログ1ページ(最大100件)分の
 * ユニークユーザーIDを一度に完全並列で叩くと429が多発するため、同時実行数を絞って処理する
 * (issue #165)。
 */
const MEMBER_LOOKUP_CONCURRENCY = 5;

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  fn: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < values.length; i += limit) {
    results.push(...(await Promise.all(values.slice(i, i + limit).map(fn))));
  }
  return results;
}

interface BulkMemberNamesResult {
  names: Map<string, string>;
  /**
   * 一括取得に含まれなかったuserIdを個別取得(getGuildMembershipと同一バケット)へフォールバックして
   * よいか。GUILD_MEMBERS Privileged Intent未設定(403)は恒久的な状態なので個別取得のみに倒してよいが、
   * 429(リトライ上限到達)・5xx等の一時的な過負荷時に個別取得へフォールバックすると、getGuildMembershipと
   * 同じバケットへ負荷を付け替えてしまい本修正の目的が崩れるため許可しない(その回は表示名解決を諦める)。
   */
  allowIndividualFallback: boolean;
}

/**
 * `/guilds/{id}/members?limit=1000`(一括取得、fetchGuildMembersPageと同じエンドポイント)は
 * `/guilds/{id}/members/{userId}`(個別取得、getGuildMembershipが使うエンドポイント)とは
 * 別のレート制限バケットのため、ここで一括取得しておけばgetGuildMembershipの応答を遅延させない
 * (issue #213)。1000人を超えるguildでは最初の1000人(idの昇順)のみが対象になり、それ以外は
 * allowIndividualFallback=trueの場合のみ個別取得にフォールバックする。
 */
async function fetchBulkMemberNames(botToken: string, guildId: string): Promise<BulkMemberNamesResult> {
  try {
    const page = await fetchGuildMembersPage(botToken, guildId);
    return { names: new Map(page.members.map((member) => [member.id, member.name])), allowIndividualFallback: true };
  } catch (error) {
    if (error instanceof DiscordAccessForbiddenError) {
      return { names: new Map(), allowIndividualFallback: true };
    }
    console.error(`Failed to bulk-fetch guild members for guild ${guildId}`, error);
    return { names: new Map(), allowIndividualFallback: false };
  }
}

/**
 * 指定したuserIdごとにguild memberを引き、表示名(サーバーニックネーム > global_name > username)を
 * 解決する。429自体はdiscordGet共通でリトライし、同時実行数もMEMBER_LOOKUP_CONCURRENCYで絞る。
 * guild memberが404(脱退済み等)の場合は`/users/{id}`にフォールバックし、ニックネームなしでglobal_name/usernameを解決する
 * (issue #165)。個別リクエストが失敗(5xx等)した場合や、脱退済みかつユーザー自体も404(アカウント削除済み等)の場合は
 * Mapに含めない(呼び出し側でIDそのまま表示にフォールバックする。1件の失敗で表示名解決全体を巻き込まないため)。
 */
async function fetchMemberNamesIndividually(
  botToken: string,
  guildId: string,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const entries = await mapWithConcurrency(userIds, MEMBER_LOOKUP_CONCURRENCY, async (userId) => {
    let member: z.infer<typeof guildMemberWithUserSchema> | "not_found";
    try {
      member = await discordGet(botToken, `/guilds/${guildId}/members/${userId}`, guildMemberWithUserSchema);
    } catch (error) {
      console.error(`Failed to fetch guild member ${userId} in guild ${guildId}`, error);
      return undefined;
    }
    if (member === "not_found") {
      let user: z.infer<typeof userSchema> | "not_found";
      try {
        user = await discordGet(botToken, `/users/${userId}`, userSchema);
      } catch (error) {
        console.error(`Failed to fetch user ${userId}`, error);
        return undefined;
      }
      if (user === "not_found") return undefined;
      return [userId, user.global_name || user.username] as const;
    }
    const name = member.nick || member.user.global_name || member.user.username;
    return [userId, name] as const;
  });
  return new Map(entries.filter((entry): entry is readonly [string, string] => entry !== undefined));
}

export async function fetchGuildMemberNames(
  botToken: string,
  guildId: string,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();

  const { names: bulkNames, allowIndividualFallback } = await fetchBulkMemberNames(botToken, guildId);
  const missingUserIds = userIds.filter((userId) => !bulkNames.has(userId));
  const fallbackNames =
    allowIndividualFallback && missingUserIds.length > 0
      ? await fetchMemberNamesIndividually(botToken, guildId, missingUserIds)
      : new Map();

  const names = new Map(bulkNames);
  for (const [userId, name] of fallbackNames) {
    names.set(userId, name);
  }
  return new Map(userIds.flatMap((userId) => (names.has(userId) ? [[userId, names.get(userId)!] as const] : [])));
}
