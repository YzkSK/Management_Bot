import type { Redis } from "ioredis";
import {
  parseTempVoiceActionResult,
  serializeTempVoiceActionResult,
  TEMP_VOICE_ACTION_RESULT_FIELD,
  type TempVoiceActionResult,
  tempVoiceActionResultKey,
} from "../domain/index.js";

/** Dashboardが結果を読み終えれば不要なため短いTTL。書き込みのたびに延長する。 */
export const TEMP_VOICE_ACTION_RESULT_TTL_SECONDS = 60;

export async function writeTempVoiceActionResult(
  redis: Redis,
  guildId: string,
  requestId: string,
  result: TempVoiceActionResult,
): Promise<void> {
  const key = tempVoiceActionResultKey(guildId, requestId);
  await redis
    .multi()
    .hset(key, TEMP_VOICE_ACTION_RESULT_FIELD, serializeTempVoiceActionResult(result))
    .expire(key, TEMP_VOICE_ACTION_RESULT_TTL_SECONDS)
    .exec();
}

/**
 * dashboard-api用。botが結果を書くまで一定間隔でポーリングする。上限まで待っても(または結果が不正でも)
 * 得られなければundefined(タイムアウト)。Redisクライアントに依存しないようHash読み取り関数を受け取る。
 */
export async function waitForTempVoiceActionResult(
  readHash: (key: string) => Promise<Record<string, string>>,
  guildId: string,
  requestId: string,
  options: { intervalMs: number; timeoutMs: number },
): Promise<TempVoiceActionResult | undefined> {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    const hash = await readHash(tempVoiceActionResultKey(guildId, requestId));
    const result = parseTempVoiceActionResult(hash[TEMP_VOICE_ACTION_RESULT_FIELD]);
    if (result) return result;
    if (Date.now() >= deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
}
