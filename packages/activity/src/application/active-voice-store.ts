import type { Redis } from "ioredis";
import {
  type ActiveVoiceChannel,
  type ActiveVoiceEntry,
  type ActiveVoiceJoined,
  activeVoiceJoinedKey,
  activeVoiceKey,
  groupActiveVoice,
  parseActiveVoiceEntry,
  parseActiveVoiceJoined,
} from "../domain/index.js";

/** botが落ちたら表示が自然に消えるよう、botが定期的に延長する前提の短いTTL。 */
export const ACTIVE_VOICE_TTL_SECONDS = 120;

export async function getActiveVoiceEntry(redis: Redis, guildId: string, userId: string): Promise<ActiveVoiceEntry | undefined> {
  return parseActiveVoiceEntry(await redis.hget(activeVoiceKey(guildId), userId));
}

/** 表示用エントリが期限切れでも入室時刻を引き継げるよう、長めのTTLで別Hashに残す。 */
export const ACTIVE_VOICE_JOINED_TTL_SECONDS = 24 * 60 * 60;

export async function getActiveVoiceJoined(redis: Redis, guildId: string, userId: string): Promise<ActiveVoiceJoined | undefined> {
  return parseActiveVoiceJoined(await redis.hget(activeVoiceJoinedKey(guildId), userId));
}

export async function upsertActiveVoice(redis: Redis, guildId: string, userId: string, entry: ActiveVoiceEntry): Promise<void> {
  const key = activeVoiceKey(guildId);
  const joinedKey = activeVoiceJoinedKey(guildId);
  const joined: ActiveVoiceJoined = { channelId: entry.channelId, joinedAt: entry.joinedAt };
  await redis
    .multi()
    .hset(key, userId, JSON.stringify(entry))
    .expire(key, ACTIVE_VOICE_TTL_SECONDS)
    .hset(joinedKey, userId, JSON.stringify(joined))
    .expire(joinedKey, ACTIVE_VOICE_JOINED_TTL_SECONDS)
    .exec();
}

export async function removeActiveVoice(redis: Redis, guildId: string, userId: string): Promise<void> {
  await redis.multi().hdel(activeVoiceKey(guildId), userId).hdel(activeVoiceJoinedKey(guildId), userId).exec();
}

/** checkpointでcountingSinceを進める。退室済み(エントリ無し)なら書き戻さない。同一メンバーのキュー上で呼ぶこと。 */
export async function setActiveVoiceCountingSince(
  redis: Redis,
  guildId: string,
  userId: string,
  countingSince: string | null,
): Promise<boolean> {
  const entry = await getActiveVoiceEntry(redis, guildId, userId);
  if (!entry) return false;
  await upsertActiveVoice(redis, guildId, userId, { ...entry, countingSince });
  return true;
}

/** 起動時の作り直しで、いなくなったメンバーを見つけるために使う(入室時刻Hashにだけ残るメンバーも含む)。 */
export async function listActiveVoiceUserIds(redis: Redis, guildId: string): Promise<string[]> {
  const [shown, joined] = await Promise.all([redis.hkeys(activeVoiceKey(guildId)), redis.hkeys(activeVoiceJoinedKey(guildId))]);
  return [...new Set([...shown, ...joined])];
}

export async function extendActiveVoiceTtl(redis: Redis, guildIds: readonly string[]): Promise<void> {
  if (guildIds.length === 0) return;
  const pipeline = redis.pipeline();
  for (const guildId of guildIds) {
    pipeline.expire(activeVoiceKey(guildId), ACTIVE_VOICE_TTL_SECONDS);
    pipeline.expire(activeVoiceJoinedKey(guildId), ACTIVE_VOICE_JOINED_TTL_SECONDS);
  }
  await pipeline.exec();
}

/** dashboard-api用。Redisクライアントに依存しないよう、Hash読み取り関数を受け取る。 */
export async function readActiveVoice(
  readHash: (key: string) => Promise<Record<string, string>>,
  guildId: string,
): Promise<ActiveVoiceChannel[]> {
  return groupActiveVoice(await readHash(activeVoiceKey(guildId)));
}
