import type { Client, VoiceState } from "discord.js";
import type { Redis } from "ioredis";
import {
  extendActiveVoiceTtl,
  getActiveVoiceEntry,
  removeActiveVoice,
  replaceActiveVoice,
  upsertActiveVoice,
} from "../application/index.js";
import { type ActiveVoiceEntry, nextJoinedAt } from "../domain/index.js";

/** VoiceStateのうち変換に使う部分(テストで組み立てやすくするための構造型)。 */
export interface ActiveVoiceStateLike {
  channelId: string | null;
  channel: { name: string } | null;
  guild: { afkChannelId: string | null };
  member: { displayName: string; displayAvatarURL: (options?: { size?: number }) => string } | null;
  selfMute: boolean | null;
  selfDeaf: boolean | null;
  serverMute: boolean | null;
  serverDeaf: boolean | null;
  streaming: boolean | null;
  selfVideo: boolean | null;
}

export function toActiveVoiceEntry(state: ActiveVoiceStateLike, joinedAt: string): ActiveVoiceEntry | undefined {
  if (state.channelId === null || state.channel === null || state.member === null) return undefined;
  return {
    channelId: state.channelId,
    channelName: state.channel.name,
    afk: state.channelId === state.guild.afkChannelId,
    name: state.member.displayName,
    avatarUrl: state.member.displayAvatarURL({ size: 64 }),
    joinedAt,
    selfMute: state.selfMute ?? false,
    selfDeaf: state.selfDeaf ?? false,
    serverMute: state.serverMute ?? false,
    serverDeaf: state.serverDeaf ?? false,
    streaming: state.streaming ?? false,
    video: state.selfVideo ?? false,
  };
}

export async function syncActiveVoice(redis: Redis, state: VoiceState, now: Date): Promise<void> {
  const guildId = state.guild.id;
  if (state.channelId === null) return removeActiveVoice(redis, guildId, state.id);
  const prev = await getActiveVoiceEntry(redis, guildId, state.id);
  const entry = toActiveVoiceEntry(state, nextJoinedAt(prev, state.channelId, now));
  if (entry) await upsertActiveVoice(redis, guildId, state.id, entry);
}

/** 起動時: 再起動前の在室時間は分からないため、入室時刻は起動時刻とする(既知の制約)。 */
export async function rebuildActiveVoice(redis: Redis, client: Client, now: Date): Promise<void> {
  await Promise.all(
    client.guilds.cache.map((guild) => {
      const entries = new Map<string, ActiveVoiceEntry>();
      for (const state of guild.voiceStates.cache.values()) {
        if (state.member?.user.bot) continue;
        const entry = toActiveVoiceEntry(state, now.toISOString());
        if (entry) entries.set(state.id, entry);
      }
      return replaceActiveVoice(redis, guild.id, entries);
    }),
  );
}

export function extendAllActiveVoiceTtl(redis: Redis, client: Client): Promise<void> {
  return extendActiveVoiceTtl(redis, [...client.guilds.cache.keys()]);
}
