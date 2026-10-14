import type { Db } from "@management-bot/db";
import type { Client, VoiceBasedChannel, VoiceState } from "discord.js";
import type { Redis } from "ioredis";
import {
  extendTempVoiceStateTtl,
  listTempVoiceChannelsByGuild,
  listTempVoiceGuildIds,
  listTempVoiceStateChannelIds,
  removeTempVoiceState,
  upsertTempVoiceState,
} from "../application/index.js";
import type { TempVoiceChannelState } from "../domain/index.js";
import { readTempVoiceState } from "./control-panel-message.js";
import type { VoiceSessionStore } from "./voice-session-store.js";

export interface SyncChannelStateDeps {
  redis: Redis;
  sessionStore: VoiceSessionStore;
}

/** 一時VCの現在状態(人数制限・音質・ロック/非表示・在室メンバー)をDiscordのキャッシュから組み立てる。 */
export function buildTempVoiceChannelState(channel: VoiceBasedChannel): TempVoiceChannelState {
  return {
    ...readTempVoiceState(channel),
    members: [...channel.members.values()]
      .filter((member) => !member.user.bot)
      .map((member) => ({
        userId: member.id,
        name: member.displayName,
        avatarUrl: member.displayAvatarURL({ size: 64 }),
        selfMute: member.voice.selfMute ?? false,
        serverMute: member.voice.serverMute ?? false,
        selfDeaf: member.voice.selfDeaf ?? false,
        serverDeaf: member.voice.serverDeaf ?? false,
        streaming: member.voice.streaming ?? false,
        video: member.voice.selfVideo ?? false,
      })),
  };
}

/**
 * 追跡中の一時VCなら現在状態をRedisへ書き直す。状態はイベント受信時に同期的に組み立てるため、
 * 連続イベントでもRedisへは発生順に書かれる(単一接続のコマンドは順序が保たれる)。
 * ponytail: 失敗はログのみ(次のイベント・起動時の作り直しで回復する)。
 */
export function syncTempVoiceChannelState(deps: SyncChannelStateDeps, channel: VoiceBasedChannel | null): void {
  if (!channel || !deps.sessionStore.isTracked(channel.id)) return;
  upsertTempVoiceState(deps.redis, channel.guild.id, channel.id, buildTempVoiceChannelState(channel)).catch((error: unknown) => {
    console.error(`temp-voice: failed to sync channel state for channel ${channel.id}`, error);
  });
}

/** voiceStateUpdate用。旧・新どちらのチャンネルも(追跡中なら)書き直す。 */
export function syncTempVoiceChannelStateOnVoiceUpdate(deps: SyncChannelStateDeps, oldState: VoiceState, newState: VoiceState): void {
  syncTempVoiceChannelState(deps, oldState.channel);
  if (newState.channelId !== oldState.channelId) syncTempVoiceChannelState(deps, newState.channel);
}

export function removeTempVoiceChannelState(deps: SyncChannelStateDeps, guildId: string, channelId: string): void {
  removeTempVoiceState(deps.redis, guildId, channelId).catch((error: unknown) => {
    console.error(`temp-voice: failed to remove channel state for channel ${channelId}`, error);
  });
}

/**
 * 起動時の作り直し。DB上の一時VCを全部書き直し、DBに無い(削除済みの)fieldを消す。
 * リコンサイルで片肺チャンネルが削除された後に呼ぶため、DBに残っていてもDiscord上に無いものは書かない。
 */
export async function rebuildTempVoiceChannelStates(
  deps: SyncChannelStateDeps & {
    db: Db;
    client: Client;
    /** テスト用のDI。省略時はDBから取得する。 */
    listGuildIds?: typeof listTempVoiceGuildIds;
    listChannels?: typeof listTempVoiceChannelsByGuild;
  },
): Promise<void> {
  const listGuildIds = deps.listGuildIds ?? listTempVoiceGuildIds;
  const listChannels = deps.listChannels ?? listTempVoiceChannelsByGuild;
  // DBに一時VCが無いギルドのRedisにも古いfieldが残りうるため、botが参加している全ギルドも対象にする。
  const guildIds = new Set([...(await listGuildIds(deps.db)), ...deps.client.guilds.cache.keys()]);
  for (const guildId of guildIds) {
    const rows = await listChannels(deps.db, guildId);
    const live = new Set<string>();
    for (const row of rows) {
      const channel = deps.client.guilds.cache.get(guildId)?.channels.cache.get(row.channelId);
      if (!channel?.isVoiceBased()) continue;
      live.add(row.channelId);
      await upsertTempVoiceState(deps.redis, guildId, row.channelId, buildTempVoiceChannelState(channel));
    }
    for (const channelId of await listTempVoiceStateChannelIds(deps.redis, guildId)) {
      if (!live.has(channelId)) await removeTempVoiceState(deps.redis, guildId, channelId);
    }
  }
}

export function extendAllTempVoiceStateTtl(redis: Redis, client: Client): Promise<void> {
  return extendTempVoiceStateTtl(redis, [...client.guilds.cache.keys()]);
}
