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
  /** rename成功時に呼び出し元(discord/index.ts)がrenameTimestampsへ記録できるよう通知するコールバック。 */
  onRenameSucceeded: (channelId: string, at: number) => void;
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
  await interaction.deferUpdate();
  await interaction.message?.edit({
    flags: MessageFlags.IsComponentsV2,
    components: [buildControlPanelContainer(channelId, readTempVoiceState(voiceChannel))],
  });
}

/**
 * モーダル送信(rename/userLimit/bitrate)を処理する(#408)。入力値検証→Discord API呼び出し→
 * 制御パネルメッセージのedit→temp-voice.event.recordedのpublish、の順で行う。
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
      const before = voiceChannel.name;
      const controlChannel = interaction.guild?.channels.cache.get(row.controlChannelId);

      suppressTempVoiceChannelLog(voiceChannel.id);
      await voiceChannel.setName(validated.value, TEMP_VOICE_UPDATE_REASON);
      if (controlChannel?.isTextBased() && "setName" in controlChannel) {
        suppressTempVoiceChannelLog(controlChannel.id);
        await controlChannel.setName(validated.value, TEMP_VOICE_UPDATE_REASON).catch((error: unknown) => {
          // VC側は既に変更済みのため、制御チャンネル側のみ失敗した場合も処理は継続する
          // (issueの指示: 失敗した方だけ再試行、最終的な整合性は#412のリコンサイルに委ねる)。
          console.error(`temp-voice: failed to rename control channel ${controlChannel.id}`, error);
        });
      }
      deps.onRenameSucceeded(voiceChannel.id, Date.now());

      await updateControlPanel(interaction, voiceChannel.id, voiceChannel);
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
      const before = voiceChannel.userLimit;
      suppressTempVoiceChannelLog(voiceChannel.id);
      await voiceChannel.setUserLimit(validated.value, TEMP_VOICE_UPDATE_REASON);

      await updateControlPanel(interaction, voiceChannel.id, voiceChannel);
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
      const before = voiceChannel.bitrate;
      suppressTempVoiceChannelLog(voiceChannel.id);
      await voiceChannel.setBitrate(validated.value, TEMP_VOICE_UPDATE_REASON);

      await updateControlPanel(interaction, voiceChannel.id, voiceChannel);
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
