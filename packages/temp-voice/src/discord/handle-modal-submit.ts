import type { DomainEventBus } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import { TEMP_VOICE_UPDATE_REASON, suppressTempVoiceChannelLog } from "@management-bot/shared";
import { validateBitrateKbps, validateChannelName, validateUserLimit } from "../domain/index.js";
import { findTempVoiceChannel } from "../application/index.js";
import { buildControlPanelContainer, parseTempVoiceCustomId, readTempVoiceState } from "./control-panel-message.js";
import { MessageFlags, type ModalSubmitInteraction, type VoiceBasedChannel } from "discord.js";

export interface HandleModalSubmitDeps {
  db: Db;
  eventBus: DomainEventBus;
  /**
   * renameを実際に実行する直前に呼ぶ、チェックと予約(タイムスタンプ追加)をアトミックに行う関数。
   * falseが返ればレート制限超過(モーダル表示から送信までの間に他の実行が割り込んだ場合、
   * ボタン押下時のcanRenameチェックだけでは防げないTOCTOUをここで防ぐ、codexレビュー指摘)。
   */
  tryReserveRenameSlot: (channelId: string) => boolean;
}

async function replyOwnerOnly(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.reply({ content: "このVCのオーナーのみ操作できます。", flags: MessageFlags.Ephemeral });
}

/**
 * ModalSubmitInteractionにはButtonInteraction.updateに相当するAPIが無いため、
 * deferUpdate()でインタラクションへの応答を完了させたうえで、元の制御パネルメッセージ
 * (interaction.message)を直接editする。
 */
async function updateControlPanel(
  interaction: ModalSubmitInteraction,
  channelId: string,
  voiceChannel: VoiceBasedChannel,
): Promise<void> {
  await interaction.message?.edit({
    flags: MessageFlags.IsComponentsV2,
    components: [buildControlPanelContainer(channelId, readTempVoiceState(voiceChannel))],
  });
}

/**
 * モーダル送信(rename/userLimit/bitrate)を処理する(#408)。入力値検証→deferUpdate→
 * Discord API呼び出し→制御パネルメッセージのedit→temp-voice.event.recordedのpublish、の順で行う。
 * Discord APIのmutationは3秒のインタラクション応答期限を超えうるため、mutation前に必ず
 * deferUpdate()で応答を確定させる(codexレビュー指摘)。mutation失敗時はephemeralフォローアップで
 * 案内し、例外を再throwして呼び出し元にログさせる。
 * renameのみVC・制御チャンネル両方の名前を更新する(issueの指示: 同名を維持)。
 */
export async function handleTempVoiceModalSubmit(
  deps: HandleModalSubmitDeps,
  interaction: ModalSubmitInteraction,
): Promise<void> {
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

  const inputValue = interaction.fields.getTextInputValue("value");

  switch (parsed.action) {
    case "rename": {
      const validated = validateChannelName(inputValue);
      if (!validated.ok) {
        await interaction.reply({ content: validated.message, flags: MessageFlags.Ephemeral });
        return;
      }
      if (!deps.tryReserveRenameSlot(parsed.channelId)) {
        await interaction.reply({
          content: "名前の変更回数が上限に達しました。しばらく待ってから再度お試しください。",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferUpdate();
      const before = voiceChannel.name;
      const controlChannel = interaction.guild?.channels.cache.get(row.controlChannelId);
      let updatedVoiceChannel: VoiceBasedChannel;

      suppressTempVoiceChannelLog(voiceChannel.id);
      try {
        updatedVoiceChannel = await voiceChannel.setName(validated.value, TEMP_VOICE_UPDATE_REASON);
      } catch (error) {
        await interaction.followUp({ content: "名前の変更に失敗しました。時間を置いて再度お試しください。", flags: MessageFlags.Ephemeral });
        throw error;
      }

      let controlChannelRenameFailed = false;
      if (controlChannel?.isTextBased() && "setName" in controlChannel) {
        suppressTempVoiceChannelLog(controlChannel.id);
        await controlChannel.setName(validated.value, TEMP_VOICE_UPDATE_REASON).catch((error: unknown) => {
          // VC側は既に変更済みのため、制御チャンネル側のみ失敗した場合も処理は継続する
          // (issueの指示: 失敗した方だけ再試行、最終的な整合性は#412のリコンサイルに委ねる)。
          // オーナーに気づけない不整合が残らないよう、成功扱いにはせずephemeralで案内する(codexレビュー指摘)。
          controlChannelRenameFailed = true;
          console.error(`temp-voice: failed to rename control channel ${controlChannel.id}`, error);
        });
      }
      if (controlChannelRenameFailed) {
        await interaction.followUp({
          content: "VCの名前は変更されましたが、制御チャンネルの名前変更には失敗しました。しばらくしてから再度名前を変更してください。",
          flags: MessageFlags.Ephemeral,
        });
      }

      await updateControlPanel(interaction, voiceChannel.id, updatedVoiceChannel);
      await deps.eventBus.publish({
        type: "temp-voice.event.recorded",
        action: "renamed",
        guildId: row.guildId,
        channelId: voiceChannel.id,
        executorId: interaction.user.id,
        executorName: interaction.user.displayName,
        before,
        after: validated.value,
        createdAt: new Date().toISOString(),
      });
      return;
    }
    case "userLimit": {
      const validated = validateUserLimit(inputValue);
      if (!validated.ok) {
        await interaction.reply({ content: validated.message, flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferUpdate();
      const before = voiceChannel.userLimit;
      suppressTempVoiceChannelLog(voiceChannel.id);
      let updatedVoiceChannel: VoiceBasedChannel;
      try {
        updatedVoiceChannel = await voiceChannel.setUserLimit(validated.value, TEMP_VOICE_UPDATE_REASON);
      } catch (error) {
        await interaction.followUp({ content: "人数制限の変更に失敗しました。時間を置いて再度お試しください。", flags: MessageFlags.Ephemeral });
        throw error;
      }

      await updateControlPanel(interaction, voiceChannel.id, updatedVoiceChannel);
      await deps.eventBus.publish({
        type: "temp-voice.event.recorded",
        action: "userLimitChanged",
        guildId: row.guildId,
        channelId: voiceChannel.id,
        executorId: interaction.user.id,
        executorName: interaction.user.displayName,
        before,
        after: validated.value,
        createdAt: new Date().toISOString(),
      });
      return;
    }
    case "bitrate": {
      const maximumBitrateBps = interaction.guild?.maximumBitrate ?? 96_000;
      const validated = validateBitrateKbps(inputValue, maximumBitrateBps);
      if (!validated.ok) {
        await interaction.reply({ content: validated.message, flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferUpdate();
      const before = voiceChannel.bitrate;
      suppressTempVoiceChannelLog(voiceChannel.id);
      let updatedVoiceChannel: VoiceBasedChannel;
      try {
        updatedVoiceChannel = await voiceChannel.setBitrate(validated.value, TEMP_VOICE_UPDATE_REASON);
      } catch (error) {
        await interaction.followUp({ content: "音質の変更に失敗しました。時間を置いて再度お試しください。", flags: MessageFlags.Ephemeral });
        throw error;
      }

      await updateControlPanel(interaction, voiceChannel.id, updatedVoiceChannel);
      await deps.eventBus.publish({
        type: "temp-voice.event.recorded",
        action: "bitrateChanged",
        guildId: row.guildId,
        channelId: voiceChannel.id,
        executorId: interaction.user.id,
        executorName: interaction.user.displayName,
        before,
        after: validated.value,
        createdAt: new Date().toISOString(),
      });
      return;
    }
    case "toggleLock":
    case "toggleHide":
      // ボタン即時実行のみでモーダルを開かないため、このパスには到達しない。
      return;
  }
}
