import type { Db } from "@management-bot/db";
import { tempVoiceChannels, tempVoiceConfigs } from "@management-bot/db";
import { and, eq } from "drizzle-orm";

export interface TempVoiceConfig {
  guildId: string;
  createChannelId: string;
  categoryId: string;
  nameTemplate: string;
  defaultUserLimit: number;
  defaultBitrate: number | null;
}

/** ギルドの一時VC設定を取得する。未設定(temp-voice機能が未セットアップ)ならnull。 */
export async function getTempVoiceConfig(db: Db, guildId: string): Promise<TempVoiceConfig | null> {
  const [row] = await db.select().from(tempVoiceConfigs).where(eq(tempVoiceConfigs.guildId, guildId));
  return row ?? null;
}

/** ユーザーが既にオーナーとして持っている一時VCのchannelIdを返す。無ければnull(1ユーザー1VCまでの事前チェック用)。 */
export async function findOwnedTempVoiceChannelId(db: Db, guildId: string, ownerId: string): Promise<string | null> {
  const [match] = await db
    .select({ channelId: tempVoiceChannels.channelId })
    .from(tempVoiceChannels)
    .where(and(eq(tempVoiceChannels.guildId, guildId), eq(tempVoiceChannels.ownerId, ownerId)));
  return match?.channelId ?? null;
}

export interface InsertTempVoiceChannelInput {
  channelId: string;
  guildId: string;
  controlChannelId: string;
  ownerId: string;
}

/**
 * Discord側のVC・制御チャンネル作成が完了した後に呼ぶ。guildId+ownerIdのunique制約
 * (#406)がrace conditionをすり抜けた多重作成を弾く。制約違反時は呼び出し元
 * (registerVoiceCreateHandler)がDiscord側の孤児チャンネルを削除してロールバックする。
 */
export async function insertTempVoiceChannel(db: Db, input: InsertTempVoiceChannelInput): Promise<void> {
  await db.insert(tempVoiceChannels).values(input);
}

/** channelId主キーのため、ロールバック(手順7のunique制約違反時)はchannelId指定で削除する。 */
export async function deleteTempVoiceChannel(db: Db, channelId: string): Promise<void> {
  await db.delete(tempVoiceChannels).where(eq(tempVoiceChannels.channelId, channelId));
}
