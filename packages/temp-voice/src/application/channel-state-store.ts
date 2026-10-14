import type { Redis } from "ioredis";
import {
  parseTempVoiceStateHash,
  serializeTempVoiceChannelState,
  type TempVoiceChannelState,
  tempVoiceStateKey,
} from "../domain/index.js";

/** botが落ちたら表示が自然に消えるよう、botが定期的に延長する前提の短いTTL(activityのアクティブVCと同じ方針)。 */
export const TEMP_VOICE_STATE_TTL_SECONDS = 120;

export async function upsertTempVoiceState(
  redis: Redis,
  guildId: string,
  channelId: string,
  state: TempVoiceChannelState,
): Promise<void> {
  const key = tempVoiceStateKey(guildId);
  await redis.multi().hset(key, channelId, serializeTempVoiceChannelState(state)).expire(key, TEMP_VOICE_STATE_TTL_SECONDS).exec();
}

export async function removeTempVoiceState(redis: Redis, guildId: string, channelId: string): Promise<void> {
  await redis.hdel(tempVoiceStateKey(guildId), channelId);
}

/** 起動時の作り直しで、DBに無いチャンネルのfieldを消すために使う。 */
export function listTempVoiceStateChannelIds(redis: Redis, guildId: string): Promise<string[]> {
  return redis.hkeys(tempVoiceStateKey(guildId));
}

export async function extendTempVoiceStateTtl(redis: Redis, guildIds: readonly string[]): Promise<void> {
  if (guildIds.length === 0) return;
  const pipeline = redis.pipeline();
  for (const guildId of guildIds) pipeline.expire(tempVoiceStateKey(guildId), TEMP_VOICE_STATE_TTL_SECONDS);
  await pipeline.exec();
}

/** dashboard-api用。Redisクライアントに依存しないよう、Hash読み取り関数を受け取る。 */
export async function readTempVoiceStates(
  readHash: (key: string) => Promise<Record<string, string>>,
  guildId: string,
): Promise<Map<string, TempVoiceChannelState>> {
  return parseTempVoiceStateHash(await readHash(tempVoiceStateKey(guildId)));
}
