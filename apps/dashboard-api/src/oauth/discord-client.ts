import { z } from "zod";

const DISCORD_API_BASE = "https://discord.com/api/v10";

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
});

export type DiscordTokenResponse = z.infer<typeof tokenResponseSchema>;

const userResponseSchema = z.object({
  id: z.string(),
  username: z.string(),
  avatar: z.string().nullable(),
});

export interface DiscordUser {
  id: string;
  username: string;
  /** アバターハッシュ。未設定(デフォルトアバター)ならnull。 */
  avatar: string | null;
}

/** ユーザーの実際のアバター、または未設定時のDiscordデフォルトアバターのCDN URLを組み立てる。 */
export function buildAvatarUrl(user: Pick<DiscordUser, "id" | "avatar">): string {
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
  }
  // 新Discord IDシステムでのデフォルトアバターの決定方法(discriminator廃止後)。
  // https://discord.com/developers/docs/reference#image-formatting-cdn-endpoints
  const defaultIndex = Number((BigInt(user.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
}

export interface ExchangeCodeInput {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export async function exchangeCodeForToken(input: ExchangeCodeInput): Promise<DiscordTokenResponse> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
  });

  const response = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`Discord token exchange failed: ${response.status}`);
  }
  return tokenResponseSchema.parse(await response.json());
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
  const response = await fetch(`${DISCORD_API_BASE}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Discord user fetch failed: ${response.status}`);
  }
  return userResponseSchema.parse(await response.json());
}

/** アクセストークンがDiscord側で失効・取り消し済み(401/403)。呼び出し元は再ログイン導線に倒すこと。 */
export class DiscordTokenInvalidError extends Error {}

const userGuildSchema = z.object({
  id: z.string(),
  name: z.string(),
  owner: z.boolean(),
  /** ビットフィールドを10進文字列で表す(discord.jsのPermissionsBitFieldと同様の理由でBigInt互換の文字列表現)。 */
  permissions: z.string().regex(/^\d+$/, "permissions must be an unsigned decimal string"),
});

export type DiscordUserGuild = z.infer<typeof userGuildSchema>;

/** ログインユーザー本人がOAuth2 accessTokenで在籍を確認できるguild一覧(`identify guilds`スコープ)。 */
export async function fetchUserGuilds(accessToken: string): Promise<readonly DiscordUserGuild[]> {
  const response = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 401 || response.status === 403) {
    throw new DiscordTokenInvalidError();
  }
  if (!response.ok) {
    throw new Error(`Discord user guilds fetch failed: ${response.status}`);
  }
  return z.array(userGuildSchema).parse(await response.json());
}

export function buildAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: "identify guilds",
    state: input.state,
  });
  return `${DISCORD_API_BASE}/oauth2/authorize?${params.toString()}`;
}
