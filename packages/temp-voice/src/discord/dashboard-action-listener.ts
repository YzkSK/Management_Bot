import type { DomainEventBus } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import {
  listenForTempVoiceAutoSetup,
  listenForTempVoiceChannelAction,
  listenForTempVoiceForceDelete,
  type TempVoiceAutoSetupNotification,
  type TempVoiceChannelActionNotification,
  type TempVoiceForceDeleteNotification,
} from "@management-bot/db";
import { ChannelType, type Client } from "discord.js";
import type { Redis } from "ioredis";
import { forceDeleteTempVoiceChannel, upsertTempVoiceConfig, writeTempVoiceActionResult } from "../application/index.js";
import type { TempVoiceActionResult } from "../domain/index.js";
import { applyDashboardAction, type ApplyDashboardActionDeps } from "./apply-dashboard-action.js";
import { createUserSerializer } from "./serialize-by-user.js";

export interface DashboardActionListenerDeps {
  client: Client;
  db: Db;
  eventBus: DomainEventBus;
  databaseUrl: string;
  /** 反映結果の書き込み先(Dashboardが失敗を検知する用、discord/index.tsのRedisクライアントを共有)。 */
  redis: Redis;
  /** renameのレート制限(ボタン経由のモーダル送信と共有、discord/index.tsで生成)。 */
  tryReserveRenameSlot: (channelId: string) => boolean;
}

/**
 * 反映結果(例外は`discord_error`)をRedisへ書き、Dashboardが失敗を検知できるようにする(Redisへの書き込み失敗はログのみ)。
 * テストでのDI用に`apply`を差し替え可能にする。
 */
export async function handleChannelActionNotification(
  deps: ApplyDashboardActionDeps & { redis: Redis; apply?: typeof applyDashboardAction },
  notification: TempVoiceChannelActionNotification,
): Promise<void> {
  let result: TempVoiceActionResult;
  try {
    result = await (deps.apply ?? applyDashboardAction)(deps, notification);
  } catch (error) {
    console.error(`temp-voice: failed to apply dashboard action for channel ${notification.channelId}`, error);
    result = { ok: false, reason: "discord_error" };
  }
  await writeTempVoiceActionResult(deps.redis, notification.guildId, notification.requestId, result).catch((error: unknown) => {
    console.error(`temp-voice: failed to write dashboard action result for channel ${notification.channelId}`, error);
  });
}

/** テストでのDI用に`upsertConfig`を差し替え可能にする。本番はデフォルト実装を使う。 */
export async function handleAutoSetupNotification(
  deps: { client: Client; db: Db; upsertConfig?: typeof upsertTempVoiceConfig },
  notification: TempVoiceAutoSetupNotification,
): Promise<void> {
  const guild = deps.client.guilds.cache.get(notification.guildId);
  if (!guild) return;

  try {
    // 固定文言(i18n対応はfeature-registry等の既存i18n機構に合わせて後続issueで拡張、現状は日本語固定)。
    const category = await guild.channels.create({ name: "一時VC", type: ChannelType.GuildCategory });
    const createChannel = await guild.channels.create({
      name: "+ VCを作成",
      type: ChannelType.GuildVoice,
      parent: category.id,
    });
    const upsert = deps.upsertConfig ?? upsertTempVoiceConfig;
    await upsert(deps.db, notification.guildId, { createChannelId: createChannel.id, categoryId: category.id });
  } catch (error) {
    console.error(`temp-voice: failed to auto-setup for guild ${notification.guildId}`, error);
  }
}

/** テストでのDI用に`forceDelete`を差し替え可能にする。本番はデフォルト実装を使う。 */
export async function handleForceDeleteNotification(
  deps: { client: Client; db: Db; eventBus: DomainEventBus; forceDelete?: typeof forceDeleteTempVoiceChannel },
  notification: TempVoiceForceDeleteNotification,
): Promise<void> {
  const guild = deps.client.guilds.cache.get(notification.guildId);
  if (!guild) return;

  const forceDelete = deps.forceDelete ?? forceDeleteTempVoiceChannel;
  await forceDelete({ db: deps.db, eventBus: deps.eventBus }, guild, notification.channelId, "dashboard").catch(
    (error: unknown) => {
      console.error(`temp-voice: failed to force-delete channel ${notification.channelId}`, error);
    },
  );
}

/**
 * 起動時にDashboard操作(自動セットアップ・強制削除)のpg_notifyを購読する(#415)。
 * 購読失敗はログ出力のみに留めbot起動をブロックしない(moderation/src/discord/index.tsと同じ設計)。
 */
export function registerDashboardActionListener(deps: DashboardActionListenerDeps): { close: () => Promise<void> } {
  const autoSetup = listenForTempVoiceAutoSetup(deps.databaseUrl, (notification) => {
    handleAutoSetupNotification(deps, notification).catch((error: unknown) => {
      console.error("temp-voice: unhandled error in auto-setup notification handler", error);
    });
  });
  autoSetup.ready.catch((error: unknown) => {
    console.error("Failed to listen for temp_voice_auto_setup", error);
  });

  const forceDelete = listenForTempVoiceForceDelete(deps.databaseUrl, (notification) => {
    handleForceDeleteNotification(deps, notification).catch((error: unknown) => {
      console.error("temp-voice: unhandled error in force-delete notification handler", error);
    });
  });
  forceDelete.ready.catch((error: unknown) => {
    console.error("Failed to listen for temp_voice_force_delete", error);
  });

  // 同じVCへの操作はチャンネル単位で直列化する(1回の保存でロック変更とオーナー移譲が並行すると、
  // 移譲で外した旧オーナーの権限を後から付け直してしまうため。codexレビュー指摘)。
  const runSerialized = createUserSerializer();
  const channelAction = listenForTempVoiceChannelAction(deps.databaseUrl, (notification) => {
    runSerialized(notification.channelId, () => handleChannelActionNotification(deps, notification)).catch((error: unknown) => {
      console.error(`temp-voice: failed to apply dashboard action for channel ${notification.channelId}`, error);
    });
  });
  channelAction.ready.catch((error: unknown) => {
    console.error("Failed to listen for temp_voice_channel_action", error);
  });

  return {
    close: async () => {
      await Promise.all([autoSetup.close(), forceDelete.close(), channelAction.close()]);
    },
  };
}
