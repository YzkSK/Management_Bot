import { z } from "zod";
import type { ChannelOption } from "@management-bot/dashboard-access";
import { isChannelSendable } from "./channel-permissions.js";

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
 * Botトークンでguild直下の全チャンネルを取得し、Botが実際にメッセージを送信できるチャンネルだけに絞り込む。
 * (チャンネル種別に加え、guildロール・チャンネルのpermission overwriteから送信権限を計算する。)
 * guildが見つからない/Botが未参加(403/404)の場合は空配列を返す。
 */
export async function fetchGuildChannels(botToken: string, guildId: string): Promise<readonly ChannelOption[]> {
  const [me, channels, roles] = await Promise.all([
    discordGet(botToken, "/users/@me", meSchema),
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
