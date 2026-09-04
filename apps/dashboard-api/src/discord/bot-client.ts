import { z } from "zod";
import type { ChannelOption } from "@management-bot/dashboard-access";

const DISCORD_API_BASE = "https://discord.com/api/v10";

/** テキストメッセージを送信できるチャンネルタイプ(discord.jsのChannelType定数値)。 */
const TEXT_SENDABLE_CHANNEL_TYPES = new Set([0, 5]); // GuildText, GuildAnnouncement

const guildChannelSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.number(),
});

/**
 * Botトークンでguild直下の全チャンネルを取得し、テキスト送信可能なチャンネル種別に絞り込む。
 * ponytail: チャンネル種別のみで絞り込み、ロール権限overwriteまでは計算しない(送信不可チャンネルが
 * 選択肢に残り得る)。実際の送信可否計算が必要になったらguildのロール一覧も取得して権限計算を行うこと。
 * guildが見つからない/Botが未参加(403/404)の場合は空配列を返す。
 */
export async function fetchGuildChannels(botToken: string, guildId: string): Promise<readonly ChannelOption[]> {
  const response = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (response.status === 403 || response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(`Discord guild channels fetch failed: ${response.status}`);
  }
  const channels = z.array(guildChannelSchema).parse(await response.json());
  return channels
    .filter((channel) => TEXT_SENDABLE_CHANNEL_TYPES.has(channel.type))
    .map((channel) => ({ id: channel.id, name: channel.name }));
}
