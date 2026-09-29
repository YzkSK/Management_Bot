import type { Redis } from "ioredis";
import {
  type ActiveVoiceChannel,
  type ActiveVoiceEntry,
  activeVoiceKey,
  groupActiveVoice,
  parseActiveVoiceEntry,
} from "../domain/index.js";

/** botが落ちたら表示が自然に消えるよう、botが定期的に延長する前提の短いTTL。 */
export const ACTIVE_VOICE_TTL_SECONDS = 120;

export async function getActiveVoiceEntry(redis: Redis, guildId: string, userId: string): Promise<ActiveVoiceEntry | undefined> {
  return parseActiveVoiceEntry(await redis.hget(activeVoiceKey(guildId), userId));
}

export async function upsertActiveVoice(redis: Redis, guildId: string, userId: string, entry: ActiveVoiceEntry): Promise<void> {
  const key = activeVoiceKey(guildId);
  await redis.multi().hset(key, userId, JSON.stringify(entry)).expire(key, ACTIVE_VOICE_TTL_SECONDS).exec();
}

export async function removeActiveVoice(redis: Redis, guildId: string, userId: string): Promise<void> {
  await redis.hdel(activeVoiceKey(guildId), userId);
}

/** 起動時の作り直しで、いなくなったメンバーを見つけるために使う。 */
export function listActiveVoiceUserIds(redis: Redis, guildId: string): Promise<string[]> {
  return redis.hkeys(activeVoiceKey(guildId));
}

export async function extendActiveVoiceTtl(redis: Redis, guildIds: readonly string[]): Promise<void> {
  if (guildIds.length === 0) return;
  const pipeline = redis.pipeline();
  for (const guildId of guildIds) pipeline.expire(activeVoiceKey(guildId), ACTIVE_VOICE_TTL_SECONDS);
  await pipeline.exec();
}

/** dashboard-api用。Redisクライアントに依存しないよう、Hash読み取り関数を受け取る。 */
export async function readActiveVoice(
  readHash: (key: string) => Promise<Record<string, string>>,
  guildId: string,
): Promise<ActiveVoiceChannel[]> {
  return groupActiveVoice(await readHash(activeVoiceKey(guildId)));
}
