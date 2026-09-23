import type { DomainEventBus } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import { TEMP_VOICE_UPDATE_REASON, suppressTempVoiceChannelLog } from "@management-bot/shared";
import { canRenameWithinRateLimit } from "../domain/index.js";
import { findTempVoiceChannel } from "../application/index.js";
import { buildControlPanelContainer, parseTempVoiceCustomId, readTempVoiceState } from "./control-panel-message.js";
import { buildTempVoiceModal } from "./control-panel-modal.js";
import { MessageFlags, type ButtonInteraction, type VoiceBasedChannel } from "discord.js";

export interface HandleButtonDeps {
  db: Db;
  eventBus: DomainEventBus;
  /** channelId → 直近rename実行時刻(ms epoch)の配列。プロセス内メモリ(#408、bot再起動で消えても実害はレート制限の目安のため許容)。 */
  renameTimestamps: Map<string, number[]>;
}

async function replyOwnerOnly(interaction: ButtonInteraction): Promise<void> {
  await interaction.reply({ content: "このVCのオーナーのみ操作できます。", flags: MessageFlags.Ephemeral });
}

async function updateControlPanel(interaction: ButtonInteraction, channelId: string, voiceChannel: VoiceBasedChannel): Promise<void> {
  await interaction.update({
    flags: MessageFlags.IsComponentsV2,
    components: [buildControlPanelContainer(channelId, readTempVoiceState(voiceChannel))],
  });
}

async function toggleEveryoneOverwrite(
  voiceChannel: VoiceBasedChannel,
  permission: "Connect" | "ViewChannel",
  currentlyDenied: boolean,
): Promise<void> {
  suppressTempVoiceChannelLog(voiceChannel.id);
  await voiceChannel.permissionOverwrites.edit(
    voiceChannel.guild.roles.everyone.id,
    { [permission]: currentlyDenied ? null : false },
    { reason: TEMP_VOICE_UPDATE_REASON },
  );
}

/**
 * ボタン押下を処理する(#408)。rename/userLimit/bitrateはモーダルを表示し、
 * toggleLock/toggleHideは即座にDiscord APIを呼んで結果をメッセージeditで反映する。
 * 全操作でオーナーチェックを最初に行う。トグルの現在状態はDBではなくDiscord側の
 * 実際のpermissionOverwriteから読み取る(control-panel-message.tsのreadTempVoiceState参照)。
 */
export async function handleTempVoiceButton(deps: HandleButtonDeps, interaction: ButtonInteraction): Promise<void> {
  const parsed = parseTempVoiceCustomId(interaction.customId);
  if (!parsed) return;

  const row = await findTempVoiceChannel(deps.db, parsed.channelId);
  if (!row || row.ownerId !== interaction.user.id) {
    await replyOwnerOnly(interaction);
    return;
  }

  const voiceChannel = interaction.guild?.channels.cache.get(parsed.channelId);
  if (!voiceChannel?.isVoiceBased()) {
    await interaction.reply({ content: "このVCは既に削除されています。", flags: MessageFlags.Ephemeral });
    return;
  }

  switch (parsed.action) {
    case "rename": {
      const timestamps = deps.renameTimestamps.get(parsed.channelId) ?? [];
      if (!canRenameWithinRateLimit(timestamps, Date.now())) {
        await interaction.reply({
          content: "名前の変更回数が上限に達しました。しばらく待ってから再度お試しください。",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.showModal(buildTempVoiceModal("rename", parsed.channelId, voiceChannel.name));
      return;
    }
    case "userLimit":
      await interaction.showModal(buildTempVoiceModal("userLimit", parsed.channelId, String(voiceChannel.userLimit)));
      return;
    case "bitrate":
      await interaction.showModal(
        buildTempVoiceModal("bitrate", parsed.channelId, String(Math.round(voiceChannel.bitrate / 1000))),
      );
      return;
    case "toggleLock": {
      const before = readTempVoiceState(voiceChannel);
      await toggleEveryoneOverwrite(voiceChannel, "Connect", before.isLocked);
      await updateControlPanel(interaction, voiceChannel.id, voiceChannel);
      await deps.eventBus.publish({
        type: "temp-voice.event.recorded",
        action: "permissionChanged",
        guildId: row.guildId,
        channelId: voiceChannel.id,
        executorId: interaction.user.id,
        executorName: interaction.user.displayName,
        permission: "connect",
        allowed: before.isLocked,
        createdAt: new Date().toISOString(),
      });
      return;
    }
    case "toggleHide": {
      const before = readTempVoiceState(voiceChannel);
      await toggleEveryoneOverwrite(voiceChannel, "ViewChannel", before.isHidden);
      await updateControlPanel(interaction, voiceChannel.id, voiceChannel);
      await deps.eventBus.publish({
        type: "temp-voice.event.recorded",
        action: "permissionChanged",
        guildId: row.guildId,
        channelId: voiceChannel.id,
        executorId: interaction.user.id,
        executorName: interaction.user.displayName,
        permission: "view",
        allowed: before.isHidden,
        createdAt: new Date().toISOString(),
      });
      return;
    }
  }
}
