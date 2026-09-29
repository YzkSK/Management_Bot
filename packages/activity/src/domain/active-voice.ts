import { z } from "zod";
import { isCounting } from "./voice-counting.js";

/** 現在VC在室状況のスナップショット(Redis Hash、field = userId)。DBには記録しない。 */
export function activeVoiceKey(guildId: string): string {
  return `activity:voice:${guildId}`;
}

export const activeVoiceEntrySchema = z.object({
  channelId: z.string(),
  channelName: z.string(),
  afk: z.boolean(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  joinedAt: z.iso.datetime(),
  selfMute: z.boolean(),
  selfDeaf: z.boolean(),
  serverMute: z.boolean(),
  serverDeaf: z.boolean(),
  streaming: z.boolean(),
  video: z.boolean(),
  /** VC時間の集計中になった時刻(checkpointで前進する)。非集計中はnull。旧形式のエントリ(項目無し)もnullとして読む。 */
  countingSince: z.iso.datetime().nullable().default(null),
});
export type ActiveVoiceEntry = z.infer<typeof activeVoiceEntrySchema>;

export interface ActiveVoiceMember {
  userId: string;
  name: string;
  avatarUrl: string | null;
  selfMute: boolean;
  selfDeaf: boolean;
  serverMute: boolean;
  serverDeaf: boolean;
  streaming: boolean;
  video: boolean;
  counting: boolean;
  countingSince: string | null;
}

export interface ActiveVoiceChannel {
  channelId: string;
  channelName: string;
  afk: boolean;
  /** 在室者のうち最も早い入室時刻(=チャンネルの継続時間の起点)。 */
  startedAt: string;
  members: ActiveVoiceMember[];
}

/** 同じチャンネル内の状態変化(ミュート等)では入室時刻を保ち、入室・移動時のみ更新する。 */
export function nextJoinedAt(prev: ActiveVoiceEntry | undefined, channelId: string, now: Date): string {
  return prev?.channelId === channelId ? prev.joinedAt : now.toISOString();
}

/** Redisの値(JSON文字列)を検証する。壊れた値は捨てる(他の在室者の表示を妨げない)。 */
export function parseActiveVoiceEntry(raw: unknown): ActiveVoiceEntry | undefined {
  if (typeof raw !== "string") return undefined;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const result = activeVoiceEntrySchema.safeParse(json);
  return result.success ? result.data : undefined;
}

export function groupActiveVoice(hash: Record<string, string>): ActiveVoiceChannel[] {
  const byChannel = new Map<string, { channel: ActiveVoiceChannel; joined: Map<string, string> }>();
  for (const [userId, raw] of Object.entries(hash)) {
    const e = parseActiveVoiceEntry(raw);
    if (!e) continue;
    let group = byChannel.get(e.channelId);
    if (!group) {
      group = {
        channel: { channelId: e.channelId, channelName: e.channelName, afk: e.afk, startedAt: e.joinedAt, members: [] },
        joined: new Map(),
      };
      byChannel.set(e.channelId, group);
    }
    if (e.joinedAt < group.channel.startedAt) group.channel.startedAt = e.joinedAt;
    group.joined.set(userId, e.joinedAt);
    group.channel.members.push({
      userId,
      name: e.name,
      avatarUrl: e.avatarUrl,
      selfMute: e.selfMute,
      selfDeaf: e.selfDeaf,
      serverMute: e.serverMute,
      serverDeaf: e.serverDeaf,
      streaming: e.streaming,
      video: e.video,
      counting: isCounting(e, e.afk ? e.channelId : null),
      countingSince: e.countingSince,
    });
  }
  const channels = [...byChannel.values()].map(({ channel, joined }) => {
    channel.members.sort((a, b) => (joined.get(a.userId) ?? "").localeCompare(joined.get(b.userId) ?? ""));
    return channel;
  });
  return channels.sort((a, b) => b.members.length - a.members.length || a.channelName.localeCompare(b.channelName));
}
