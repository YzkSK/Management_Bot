import { z } from "zod";

/** 一時VCごとの現在状態のスナップショット(Redis Hash、field = channelId)。DBには記録しない。 */
export function tempVoiceStateKey(guildId: string): string {
  return `temp-voice:state:${guildId}`;
}

export const tempVoiceMemberStateSchema = z.object({
  userId: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  selfMute: z.boolean(),
  serverMute: z.boolean(),
  selfDeaf: z.boolean(),
  serverDeaf: z.boolean(),
  streaming: z.boolean(),
  video: z.boolean(),
});
export type TempVoiceMemberState = z.infer<typeof tempVoiceMemberStateSchema>;

export const tempVoiceChannelStateSchema = z.object({
  userLimit: z.number(),
  bitrate: z.number(),
  isLocked: z.boolean(),
  isHidden: z.boolean(),
  members: z.array(tempVoiceMemberStateSchema),
});
export type TempVoiceChannelState = z.infer<typeof tempVoiceChannelStateSchema>;

/** 書き込み前にスキーマを通してJSON文字列にする(不正な値は例外)。 */
export function serializeTempVoiceChannelState(state: TempVoiceChannelState): string {
  return JSON.stringify(tempVoiceChannelStateSchema.parse(state));
}

/** Redisの値(JSON文字列)を検証する。壊れた値は捨てる(他のチャンネルの表示を妨げない)。 */
export function parseTempVoiceChannelState(raw: unknown): TempVoiceChannelState | undefined {
  if (typeof raw !== "string") return undefined;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const result = tempVoiceChannelStateSchema.safeParse(json);
  return result.success ? result.data : undefined;
}

/** Hash全体(field = channelId)をchannelId→状態のMapにする。不正なエントリは捨てる。 */
export function parseTempVoiceStateHash(hash: Record<string, string>): Map<string, TempVoiceChannelState> {
  const states = new Map<string, TempVoiceChannelState>();
  for (const [channelId, raw] of Object.entries(hash)) {
    const state = parseTempVoiceChannelState(raw);
    if (state) states.set(channelId, state);
  }
  return states;
}
