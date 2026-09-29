import type { Client } from "discord.js";
import type { Redis } from "ioredis";
import {
  extendActiveVoiceTtl,
  getActiveVoiceEntry,
  listActiveVoiceUserIds,
  removeActiveVoice,
  upsertActiveVoice,
} from "../application/index.js";
import { type ActiveVoiceEntry, nextJoinedAt } from "../domain/index.js";
import type { KeyedQueue } from "./keyed-queue.js";

/** VoiceStateのうち同期に使う部分(テストで組み立てやすくするための構造型)。 */
export interface ActiveVoiceStateLike {
  id: string;
  channelId: string | null;
  channel: { name: string } | null;
  guild: { id: string; afkChannelId: string | null };
  member: {
    displayName: string;
    displayAvatarURL: (options?: { size?: number }) => string;
    user: { bot: boolean };
  } | null;
  selfMute: boolean | null;
  selfDeaf: boolean | null;
  serverMute: boolean | null;
  serverDeaf: boolean | null;
  streaming: boolean | null;
  selfVideo: boolean | null;
}

export interface ActiveVoiceGuildLike {
  id: string;
  voiceStates: { cache: { values(): Iterable<ActiveVoiceStateLike> } };
}

/** 同一メンバーの同期を直列化するキューのキー。 */
export function activeVoiceQueueKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

/** VoiceTrackerの「集計中になった時刻」を引く(区間が無ければundefined)。 */
export type CountingSinceOf = (guildId: string, userId: string) => Date | undefined;

export function toActiveVoiceEntry(
  state: ActiveVoiceStateLike,
  joinedAt: string,
  countingSince: string | null,
): ActiveVoiceEntry | undefined {
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
    countingSince,
  };
}

/** countingSinceはキュー上で実行される時点のVoiceTrackerの値を読む(VoiceTrackerはイベント受信時に同期的に更新済み)。 */
export async function syncActiveVoice(
  redis: Redis,
  state: ActiveVoiceStateLike,
  now: Date,
  countingSinceOf: CountingSinceOf,
): Promise<void> {
  const guildId = state.guild.id;
  if (state.channelId === null) return removeActiveVoice(redis, guildId, state.id);
  const prev = await getActiveVoiceEntry(redis, guildId, state.id);
  const since = countingSinceOf(guildId, state.id);
  const entry = toActiveVoiceEntry(state, nextJoinedAt(prev, state.channelId, now), since ? since.toISOString() : null);
  if (entry) await upsertActiveVoice(redis, guildId, state.id, entry);
}

/**
 * 起動時の作り直し。ライブのvoiceStateUpdateと同じメンバー単位キューに積むことで、作り直し中に
 * 届いた入退室が古いスナップショットで上書きされないようにする。Redisにエントリが残っていれば
 * (短時間の再起動)入室時刻を引き継ぎ、無ければ起動時刻とする(それ以前の滞在は分からない)。
 */
export async function rebuildActiveVoice(
  redis: Redis,
  guilds: Iterable<ActiveVoiceGuildLike>,
  queue: KeyedQueue,
  now: Date,
  countingSinceOf: CountingSinceOf,
): Promise<void> {
  await Promise.all(
    [...guilds].map(async (guild) => {
      const stored = await listActiveVoiceUserIds(redis, guild.id);
      // ここから先は同期的にキャッシュを読み、キューに積む(await中に届いたイベントも反映済みのキャッシュを使う)。
      const present = new Set<string>();
      const tasks: Promise<void>[] = [];
      for (const state of guild.voiceStates.cache.values()) {
        if (state.member?.user.bot || state.channelId === null) continue;
        present.add(state.id);
        tasks.push(queue.run(activeVoiceQueueKey(guild.id, state.id), () => syncActiveVoice(redis, state, now, countingSinceOf)));
      }
      for (const userId of stored) {
        if (present.has(userId)) continue;
        tasks.push(queue.run(activeVoiceQueueKey(guild.id, userId), () => removeActiveVoice(redis, guild.id, userId)));
      }
      await Promise.all(tasks);
    }),
  );
}

export function extendAllActiveVoiceTtl(redis: Redis, client: Client): Promise<void> {
  return extendActiveVoiceTtl(redis, [...client.guilds.cache.keys()]);
}
