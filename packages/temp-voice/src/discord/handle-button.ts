import type { DomainEventBus } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import { TEMP_VOICE_UPDATE_REASON, shouldSuppressTempVoiceChannelLog, suppressTempVoiceChannelLog } from "@management-bot/shared";
import { findTempVoiceChannel, listPermissionOverrides } from "../application/index.js";
import { buildControlPanelContainer, parseTempVoiceCustomId, readTempVoiceState } from "./control-panel-message.js";
import { buildTempVoiceModal } from "./control-panel-modal.js";
import { buildSelectPermissionMessage } from "./select-permission-message.js";
import { buildMemberListMessage } from "./member-list-message.js";
import { MessageFlags, type ButtonInteraction, type VoiceBasedChannel } from "discord.js";

export interface HandleButtonDeps {
  db: Db;
  eventBus: DomainEventBus;
  /** モーダルを開く前の目安チェックのみ(予約はしない、実際の消費判定はモーダル送信時のtryReserveRenameSlotで行う)。 */
  canRename: (channelId: string) => boolean;
}

async function replyOwnerOnly(interaction: ButtonInteraction): Promise<void> {
  await interaction.reply({ content: "このVCのオーナーのみ操作できます。", flags: MessageFlags.Ephemeral });
}

/**
 * @returns editの戻り値(更新後のチャンネル)。permissionOverwrites.editはREST応答で解決するが、
 * 呼び出し元のvoiceChannel.permissionOverwrites.cacheが同期的に更新される保証はないため
 * (codexレビュー指摘)、戻り値をそのままパネル再描画に使う。
 */
async function toggleEveryoneOverwrite(
  voiceChannel: VoiceBasedChannel,
  permission: "Connect" | "ViewChannel",
  currentlyDenied: boolean,
): Promise<VoiceBasedChannel> {
  suppressTempVoiceChannelLog(voiceChannel.id);
  try {
    const updated = await voiceChannel.permissionOverwrites.edit(
      voiceChannel.guild.roles.everyone.id,
      { [permission]: currentlyDenied ? null : false },
      { reason: TEMP_VOICE_UPDATE_REASON },
    );
    return updated as VoiceBasedChannel;
  } catch (error) {
    // API呼び出し自体が失敗した場合、抑制エントリが消費されないまま30秒残り、
    // 無関係な次のchannelUpdateを誤って抑制してしまう(codexレビュー指摘)。ここで消費して無効化する。
    shouldSuppressTempVoiceChannelLog(voiceChannel.id);
    throw error;
  }
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
      if (!deps.canRename(parsed.channelId)) {
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
      // Discord APIのmutation(REST)は3秒のインタラクション応答期限を超えうるため、
      // 先にdeferUpdate()で応答を確定させてから処理する(codexレビュー指摘)。
      await interaction.deferUpdate();
      let updatedChannel: VoiceBasedChannel;
      try {
        updatedChannel = await toggleEveryoneOverwrite(voiceChannel, "Connect", before.isLocked);
      } catch (error) {
        await interaction.followUp({ content: "ロック状態の変更に失敗しました。時間を置いて再度お試しください。", flags: MessageFlags.Ephemeral });
        throw error;
      }
      await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [buildControlPanelContainer(voiceChannel.id, readTempVoiceState(updatedChannel))],
      });
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
      await interaction.deferUpdate();
      let updatedChannel: VoiceBasedChannel;
      try {
        updatedChannel = await toggleEveryoneOverwrite(voiceChannel, "ViewChannel", before.isHidden);
      } catch (error) {
        await interaction.followUp({ content: "表示状態の変更に失敗しました。時間を置いて再度お試しください。", flags: MessageFlags.Ephemeral });
        throw error;
      }
      await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [buildControlPanelContainer(voiceChannel.id, readTempVoiceState(updatedChannel))],
      });
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
    case "permitMember":
      await interaction.reply(buildSelectPermissionMessage("permit", parsed.channelId));
      return;
    case "denyMember":
      await interaction.reply(buildSelectPermissionMessage("deny", parsed.channelId));
      return;
    case "manageMembers": {
      const overrides = await listPermissionOverrides(deps.db, parsed.channelId);
      const targetNames = new Map<string, string>();
      for (const override of overrides) {
        const name =
          override.targetType === "user"
            ? interaction.guild?.members.cache.get(override.targetId)?.displayName
            : interaction.guild?.roles.cache.get(override.targetId)?.name;
        if (name) targetNames.set(override.targetId, name);
      }
      await interaction.reply(buildMemberListMessage(parsed.channelId, overrides, targetNames));
      return;
    }
  }
}
