import { PermissionFlagsBits, type Guild, type GuildBasedChannel, type ThreadChannel } from "discord.js";
import type { Db } from "@management-bot/db";
import {
  clearLockdownChannelSnapshots,
  getLockdownSettings,
  listLockdownChannelSnapshots,
  markLockdownApplied,
  saveLockdownChannelSnapshots,
} from "../application/index.js";

function isLockdownChannel(channel: GuildBasedChannel): channel is Exclude<GuildBasedChannel, ThreadChannel> {
  return channel.isTextBased() && !channel.isThread();
}

function getSendMessagesOverwrite(channel: Exclude<GuildBasedChannel, ThreadChannel>, guildId: string): boolean | null {
  const overwrite = channel.permissionOverwrites.cache.get(guildId);
  if (!overwrite) return null;
  if (overwrite.allow.has(PermissionFlagsBits.SendMessages)) return true;
  if (overwrite.deny.has(PermissionFlagsBits.SendMessages)) return false;
  return null;
}

/**
 * 1チャンクで連続実行する権限変更の数。Discordのグローバルレート制限(50req/s)に対して
 * 十分余裕を持たせ、ロックダウン中も他機能(raid kick等)のAPI呼び出しが通るようにする。
 */
const EDIT_CHUNK_SIZE = 10;
/** チャンク間に挟む待機時間(ms)。 */
const EDIT_CHUNK_DELAY_MS = 1_000;

export interface SynchronizeLockdownOptions {
  /** チャンク間の待機。テストで実時間待ちを避けるために差し替える。 */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 各チャンネルの権限変更を、チャンク単位で間隔を空けながら逐次実行する。
 * 1チャンネルの失敗(権限不足・削除済み等)は他チャンネルの処理を止めないようログのみ行い
 * (handle-guild-member-add.tsのraid kickと同じ方針)。
 */
async function editEachChannel<T extends { id: string }>(
  items: readonly T[],
  edit: (item: T) => Promise<unknown>,
  context: { guildId: string; operation: "lock" | "release" },
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  for (const [index, item] of items.entries()) {
    if (index > 0 && index % EDIT_CHUNK_SIZE === 0) await sleep(EDIT_CHUNK_DELAY_MS);
    try {
      await edit(item);
    } catch (error) {
      console.error(
        `moderation: failed to ${context.operation} lockdown for channel ${item.id} in guild ${context.guildId}`,
        error,
      );
    }
  }
}

type SynchronizeResult = "locked" | "released" | "unchanged";

/** guildごとに実行中(または待機中)の同期処理の末尾。 */
const syncQueues = new Map<string, Promise<unknown>>();

/**
 * Dashboardまたはレイド検知で要求されたロック状態をDiscordへ反映する。
 * ロック前の権限snapshotは初回のみ保存されるため、途中で例外停止しても再試行で元の状態を失わない。
 * 個々のチャンネルの権限変更失敗は処理を止めずログに記録し、残りのチャンネルへの反映と
 * 状態の更新は継続する(一部のチャンネルのせいでロックダウン全体が適用・解除されない事態を避ける)。
 *
 * 同じguildへの呼び出しは直列に実行する。レイド中はguildMemberAddが連続し、ロック完了
 * (markLockdownApplied)までの間に呼ばれた分がそれぞれ全チャンネルの権限変更を重複実行すると、
 * APIのレート制限をさらに圧迫するため。後続の呼び出しは先行の完了後に設定を読み直すので、
 * 先行で反映済みなら"unchanged"で即座に終わり、途中で要求が変わった場合も最新の要求が反映される。
 */
export function synchronizeLockdown(
  db: Db,
  guild: Guild,
  options: SynchronizeLockdownOptions = {},
): Promise<SynchronizeResult> {
  const previous = syncQueues.get(guild.id) ?? Promise.resolve();
  // 先行の失敗は先行の呼び出し元へ返っているため、ここでは待つだけにする。
  const current = previous.catch(() => undefined).then(() => runSynchronizeLockdown(db, guild, options));
  syncQueues.set(guild.id, current);
  const cleanup = () => {
    if (syncQueues.get(guild.id) === current) syncQueues.delete(guild.id);
  };
  current.then(cleanup, cleanup);
  return current;
}

async function runSynchronizeLockdown(
  db: Db,
  guild: Guild,
  options: SynchronizeLockdownOptions,
): Promise<SynchronizeResult> {
  const sleep = options.sleep ?? defaultSleep;
  const settings = await getLockdownSettings(db, guild.id);
  if (settings.requestedLocked && !settings.isLocked) {
    const channels = [...guild.channels.cache.values()].filter(isLockdownChannel);
    await saveLockdownChannelSnapshots(
      db,
      guild.id,
      channels.map((channel) => ({
        channelId: channel.id,
        sendMessages: getSendMessagesOverwrite(channel, guild.id),
      })),
    );
    await editEachChannel(
      channels,
      (channel) => channel.permissionOverwrites.edit(guild.id, { SendMessages: false }),
      { guildId: guild.id, operation: "lock" },
      sleep,
    );
    await markLockdownApplied(db, guild.id, true);
    return "locked";
  }

  if (!settings.requestedLocked && settings.isLocked) {
    const snapshots = await listLockdownChannelSnapshots(db, guild.id);
    const targets = snapshots.flatMap((snapshot) => {
      const channel = guild.channels.cache.get(snapshot.channelId);
      if (!channel || !isLockdownChannel(channel)) return [];
      return [{ id: channel.id, channel, sendMessages: snapshot.sendMessages }];
    });
    await editEachChannel(
      targets,
      ({ channel, sendMessages }) => channel.permissionOverwrites.edit(guild.id, { SendMessages: sendMessages }),
      { guildId: guild.id, operation: "release" },
      sleep,
    );
    await clearLockdownChannelSnapshots(db, guild.id);
    await markLockdownApplied(db, guild.id, false);
    return "released";
  }

  return "unchanged";
}
