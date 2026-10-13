import { z } from "zod";

/** Dashboard操作(pg_notify)のbot側の反映結果(Redis Hash、field = requestId)。Dashboardが失敗を検知するためのもの。 */
/** 結果は操作(requestId)ごとに別キーにし、それぞれTTLで消す(ギルド単位のHashだとTTLが延長され続け溜まるため)。 */
export function tempVoiceActionResultKey(guildId: string, requestId: string): string {
  return `temp-voice:action-result:${guildId}:${requestId}`;
}

/** 結果キーのHash内のfield名(dashboard-apiはHash読み取りしか持たないためHashに1fieldで置く)。 */
export const TEMP_VOICE_ACTION_RESULT_FIELD = "result";

export const TEMP_VOICE_ACTION_FAILURE_REASONS = [
  "rate_limited",
  "invalid_input",
  "protected_role",
  "invalid_new_owner",
  "already_owner",
  "channel_not_found",
  "transfer_failed",
  "discord_error",
] as const;
export type TempVoiceActionFailureReason = (typeof TEMP_VOICE_ACTION_FAILURE_REASONS)[number];

export const tempVoiceActionResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.enum(TEMP_VOICE_ACTION_FAILURE_REASONS) }),
]);
export type TempVoiceActionResult = z.infer<typeof tempVoiceActionResultSchema>;

/** 書き込み前にスキーマを通してJSON文字列にする(不正な値は例外)。 */
export function serializeTempVoiceActionResult(result: TempVoiceActionResult): string {
  return JSON.stringify(tempVoiceActionResultSchema.parse(result));
}

/** Redisの値(JSON文字列)を検証する。壊れた値・未書き込み(undefined)はundefined。 */
export function parseTempVoiceActionResult(raw: unknown): TempVoiceActionResult | undefined {
  if (typeof raw !== "string") return undefined;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const result = tempVoiceActionResultSchema.safeParse(json);
  return result.success ? result.data : undefined;
}
