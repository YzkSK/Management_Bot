import { z } from "zod";
import type { ChannelOption } from "@management-bot/dashboard-access";
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

const guildRoleSchema = z.object({ id: z.string(), permissions: bigintString });

const guildMemberSchema = z.object({ roles: z.array(z.string()) });

const meSchema = z.object({ id: z.string() });

const guildMemberWithUserSchema = z.object({
  nick: z.string().nullable().optional(),
  user: z.object({
    username: z.string(),
    global_name: z.string().nullable().optional(),
  }),
});

async function discordGet<T>(botToken: string, path: string, schema: z.ZodType<T>): Promise<T | "not_found"> {
  const response = await fetch(`${DISCORD_API_BASE}${path}`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (response.status === 403 || response.status === 404) {
    return "not_found";
  }
  if (!response.ok) {
    throw new Error(`Discord API request failed (${path}): ${response.status}`);
  }
  return schema.parse(await response.json());
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
    cached.catch(() => meCache.delete(botToken));
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
 * 指定したuserIdごとにguild memberを引き、表示名(サーバーニックネーム > global_name > username)を
 * 解決する。並列にfetchするが、userIds件数はダッシュボードの1ページ(最大100件)内のユニークID数程度に
 * 収まる前提(ponytail: 大量呼び出しへのレート制限対策は現時点で行わない)。
 * 脱退済み等で404の場合はMapに含めない(呼び出し側でIDそのまま表示にフォールバックする)。
 */
export async function fetchGuildMemberNames(
  botToken: string,
  guildId: string,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const entries = await Promise.all(
    userIds.map(async (userId) => {
      const member = await discordGet(
        botToken,
        `/guilds/${guildId}/members/${userId}`,
        guildMemberWithUserSchema,
      );
      if (member === "not_found") return undefined;
      const name = member.nick || member.user.global_name || member.user.username;
      return [userId, name] as const;
    }),
  );
  return new Map(entries.filter((entry): entry is readonly [string, string] => entry !== undefined));
}
