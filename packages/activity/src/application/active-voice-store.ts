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

/** 起動時の作り直し用。既存キーを消してから現在の在室者だけを書く。 */
export async function replaceActiveVoice(
  redis: Redis,
  guildId: string,
  entries: ReadonlyMap<string, ActiveVoiceEntry>,
): Promise<void> {
  const key = activeVoiceKey(guildId);
  const tx = redis.multi().del(key);
  if (entries.size > 0) {
    const fields: Record<string, string> = {};
    for (const [userId, entry] of entries) fields[userId] = JSON.stringify(entry);
    tx.hset(key, fields).expire(key, ACTIVE_VOICE_TTL_SECONDS);
  }
  await tx.exec();
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
