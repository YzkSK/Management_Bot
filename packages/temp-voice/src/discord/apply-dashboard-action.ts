import type { DomainEventBus } from "@management-bot/core";
import type { Db, TempVoiceChannelActionNotification } from "@management-bot/db";
import { TEMP_VOICE_UPDATE_REASON, shouldSuppressTempVoiceChannelLog, suppressTempVoiceChannelLog } from "@management-bot/shared";
import type { Client, Guild, VoiceBasedChannel } from "discord.js";
import {
  deletePermissionOverride,
  findOwnedTempVoiceChannelId,
  findTempVoiceChannel,
  isDenyProtectedRole,
  upsertPermissionOverride,
  type TempVoicePermissionTargetType,
} from "../application/index.js";
import { validateBitrateKbps, validateChannelName, validateUserLimit } from "../domain/index.js";
import { readTempVoiceState, type TempVoiceState } from "./control-panel-message.js";
import { executeOwnerTransfer } from "./execute-owner-transfer.js";
import { toggleEveryoneOverwrite } from "./handle-button.js";
import { kickMembersWithRole } from "./handle-select-menu.js";
import { refreshControlPanel } from "./owner-transfer-notice.js";
import { grantOwnerVoiceAccess } from "./control-channel-permission.js";

export interface ApplyDashboardActionDeps {
  client: Client;
  db: Db;
  eventBus: DomainEventBus;
  /** Discordのモーダル経由renameと共有するレート制限(2回/10分/チャンネル)。 */
  tryReserveRenameSlot: (channelId: string) => boolean;
}

function warn(channelId: string, message: string): void {
  console.warn(`temp-voice: dashboard action on ${channelId} skipped: ${message}`);
}

/**
 * Dashboardのオーナー向け設定変更(pg_notify temp_voice_channel_action、#649)をDiscordへ反映する。
 * 権限(オーナー/MANAGE_TEMP_VOICE)はAPI側で確認済みのため再確認しない。入力値の範囲は
 * Discord経路と同じdomainのバリデータで再検証する。VCが無ければ無視する。
 * 反映後のチャンネル状態のRedis同期はchannelUpdateイベントが担い、制御パネルはここで再描画する。
 */
export async function applyDashboardAction(
  deps: ApplyDashboardActionDeps,
  notification: TempVoiceChannelActionNotification,
): Promise<void> {
  const { client, db, eventBus } = deps;
  const { channelId, action } = notification;
  const guild = client.guilds.cache.get(notification.guildId);
  const row = await findTempVoiceChannel(db, channelId);
  if (!guild || !row || row.guildId !== guild.id) return;
  const voiceChannel = guild.channels.cache.get(channelId);
  if (!voiceChannel?.isVoiceBased()) return;

  const executorName = guild.members.cache.get(notification.executorId)?.displayName ?? notification.executorId;
  const executor = { executorId: notification.executorId, executorName };
  const refresh = (state?: TempVoiceState, ownerId = row.ownerId) =>
    refreshControlPanel(client, row.controlChannelId, voiceChannel, ownerId, state);
  const now = () => new Date().toISOString();
  const base = { type: "temp-voice.event.recorded" as const, guildId: row.guildId, channelId, ...executor };

  switch (action.type) {
    case "rename": {
      const validated = validateChannelName(action.name);
      if (!validated.ok) return warn(channelId, validated.message);
      if (!deps.tryReserveRenameSlot(channelId)) return warn(channelId, "rename rate limit exceeded");
      const before = voiceChannel.name;
      suppressTempVoiceChannelLog(channelId);
      let updated: VoiceBasedChannel;
      try {
        updated = await voiceChannel.setName(validated.value, TEMP_VOICE_UPDATE_REASON);
      } catch (error) {
        shouldSuppressTempVoiceChannelLog(channelId);
        throw error;
      }
      const controlChannel = guild.channels.cache.get(row.controlChannelId);
      if (controlChannel?.isTextBased() && "setName" in controlChannel) {
        suppressTempVoiceChannelLog(controlChannel.id);
        await controlChannel.setName(validated.value, TEMP_VOICE_UPDATE_REASON).catch((error: unknown) => {
          shouldSuppressTempVoiceChannelLog(controlChannel.id);
          console.error(`temp-voice: failed to rename control channel ${controlChannel.id}`, error);
        });
      }
      await refresh(readTempVoiceState(updated));
      await eventBus.publish({ ...base, action: "renamed", before, after: validated.value, createdAt: now() });
      return;
    }
    case "userLimit": {
      const validated = validateUserLimit(String(action.value));
      if (!validated.ok) return warn(channelId, validated.message);
      const before = voiceChannel.userLimit;
      suppressTempVoiceChannelLog(channelId);
      let updated: VoiceBasedChannel;
      try {
        updated = await voiceChannel.setUserLimit(validated.value, TEMP_VOICE_UPDATE_REASON);
      } catch (error) {
        shouldSuppressTempVoiceChannelLog(channelId);
        throw error;
      }
      await refresh(readTempVoiceState(updated));
      await eventBus.publish({ ...base, action: "userLimitChanged", before, after: validated.value, createdAt: now() });
      return;
    }
    case "bitrate": {
      const validated = validateBitrateKbps(String(action.kbps), guild.maximumBitrate);
      if (!validated.ok) return warn(channelId, validated.message);
      const before = voiceChannel.bitrate;
      suppressTempVoiceChannelLog(channelId);
      let updated: VoiceBasedChannel;
      try {
        updated = await voiceChannel.setBitrate(validated.value, TEMP_VOICE_UPDATE_REASON);
      } catch (error) {
        shouldSuppressTempVoiceChannelLog(channelId);
        throw error;
      }
      await refresh(readTempVoiceState(updated));
      await eventBus.publish({ ...base, action: "bitrateChanged", before, after: validated.value, createdAt: now() });
      return;
    }
    case "setLocked":
    case "setHidden": {
      const isLock = action.type === "setLocked";
      const desired = isLock ? action.locked : action.hidden;
      const before = readTempVoiceState(voiceChannel);
      const current = isLock ? before.isLocked : before.isHidden;
      if (current === desired) return; // 既に希望の状態(Discordのトグルと違い冪等)。
      // handle-button.tsのtoggleLock/toggleHideと同じ順序: オーナーの個別許可を先に確定させてから@everyoneを変更する。
      await grantOwnerVoiceAccess(voiceChannel, row.ownerId);
      await toggleEveryoneOverwrite(voiceChannel, isLock ? "Connect" : "ViewChannel", current);
      await refresh(isLock ? { ...before, isLocked: desired } : { ...before, isHidden: desired });
      await eventBus.publish({
        ...base,
        action: "permissionChanged",
        permission: isLock ? "connect" : "view",
        allowed: !desired,
        createdAt: now(),
      });
      return;
    }
    case "permit":
    case "deny": {
      const state = action.type === "permit" ? "allow" : "deny";
      if (state === "deny" && action.targetType === "role" && (await isDenyProtectedRole(db, row.guildId, action.targetId))) {
        return warn(channelId, "protected role cannot be denied");
      }
      await applyOverride(deps, guild, voiceChannel, action.targetType, action.targetId, state);
      await refresh();
      await eventBus.publish({
        ...base,
        action: "memberPermissionChanged",
        state,
        targetType: action.targetType,
        targetId: action.targetId,
        targetName: targetName(guild, action.targetType, action.targetId),
        createdAt: now(),
      });
      return;
    }
    case "removeOverride": {
      // handle-remove-member.tsと同じ: overwrite全体の削除ではなくConnectキーのみクリアする。
      suppressTempVoiceChannelLog(channelId);
      try {
        await voiceChannel.permissionOverwrites.edit(action.targetId, { Connect: null }, { reason: TEMP_VOICE_UPDATE_REASON });
      } catch (error) {
        shouldSuppressTempVoiceChannelLog(channelId);
        throw error;
      }
      await deletePermissionOverride(db, channelId, action.targetType, action.targetId);
      await refresh();
      await eventBus.publish({
        ...base,
        action: "memberPermissionChanged",
        state: "cleared",
        targetType: action.targetType,
        targetId: action.targetId,
        targetName: targetName(guild, action.targetType, action.targetId),
        createdAt: now(),
      });
      return;
    }
    case "transferOwner": {
      const newOwnerMember = voiceChannel.members.get(action.userId);
      if (!newOwnerMember || action.userId === row.ownerId) return warn(channelId, "new owner is not another member in the channel");
      if (await findOwnedTempVoiceChannelId(db, row.guildId, action.userId)) {
        return warn(channelId, "new owner already owns another temp voice channel");
      }
      await executeOwnerTransfer({
        db,
        client,
        eventBus,
        row,
        voiceChannel,
        newOwnerMember,
        executor: { id: notification.executorId, name: executorName },
        previousOwnerName: guild.members.cache.get(row.ownerId)?.displayName ?? row.ownerId,
        onFailure: async (content) => {
          console.error(`temp-voice: dashboard owner transfer failed for ${channelId}: ${content}`);
        },
        refreshPanel: () => refresh(undefined, newOwnerMember.id),
      });
      return;
    }
  }
}

function targetName(guild: Guild, targetType: TempVoicePermissionTargetType, targetId: string): string | undefined {
  return targetType === "user" ? guild.members.cache.get(targetId)?.displayName : guild.roles.cache.get(targetId)?.name;
}

/** handle-select-menu.tsと同じ流れ: Discord個別overwrite→DB UPSERT(失敗時はロールバック)→(拒否のみ)対象を切断。 */
async function applyOverride(
  deps: ApplyDashboardActionDeps,
  guild: Guild,
  voiceChannel: VoiceBasedChannel,
  targetType: TempVoicePermissionTargetType,
  targetId: string,
  state: "allow" | "deny",
): Promise<void> {
  suppressTempVoiceChannelLog(voiceChannel.id);
  let updatedChannel: VoiceBasedChannel;
  try {
    updatedChannel = (await voiceChannel.permissionOverwrites.edit(
      targetId,
      { Connect: state === "allow" },
      { reason: TEMP_VOICE_UPDATE_REASON },
    )) as VoiceBasedChannel;
  } catch (error) {
    shouldSuppressTempVoiceChannelLog(voiceChannel.id);
    throw error;
  }

  try {
    await upsertPermissionOverride(deps.db, { channelId: voiceChannel.id, targetType, targetId, state });
  } catch (error) {
    suppressTempVoiceChannelLog(voiceChannel.id);
    await voiceChannel.permissionOverwrites
      .edit(targetId, { Connect: null }, { reason: TEMP_VOICE_UPDATE_REASON })
      .catch((rollbackError: unknown) => {
        shouldSuppressTempVoiceChannelLog(voiceChannel.id);
        console.error(`temp-voice: failed to roll back overwrite for ${targetId} after DB error`, rollbackError);
      });
    throw error;
  }

  if (state === "deny") {
    if (targetType === "role") {
      await kickMembersWithRole(updatedChannel, targetId);
    } else {
      const member = guild.members.cache.get(targetId);
      if (member?.voice.channelId === voiceChannel.id) {
        await member.voice.disconnect(TEMP_VOICE_UPDATE_REASON).catch((error: unknown) => {
          console.error(`temp-voice: failed to disconnect member ${targetId} for user deny`, error);
        });
      }
    }
  }
}
