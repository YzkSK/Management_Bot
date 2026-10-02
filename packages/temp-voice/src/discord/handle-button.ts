import type { DomainEventBus } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import { TEMP_VOICE_UPDATE_REASON, shouldSuppressTempVoiceChannelLog, suppressTempVoiceChannelLog } from "@management-bot/shared";
import { findTempVoiceChannel, listPermissionOverrides } from "../application/index.js";
import { grantOwnerVoiceAccess } from "./control-channel-permission.js";
import { buildControlPanelContainer, parseTempVoiceCustomId, readTempVoiceState } from "./control-panel-message.js";
import { buildTempVoiceModal } from "./control-panel-modal.js";
import { buildSelectPermissionMessage } from "./select-permission-message.js";
import { buildMemberListMessage } from "./member-list-message.js";
import { buildTransferOwnerMessage } from "./transfer-owner-message.js";
import { MessageFlags, type ButtonInteraction, type GuildMember, type VoiceBasedChannel } from "discord.js";
import { statusText } from "./status-text.js";

export interface HandleButtonDeps {
  db: Db;
  eventBus: DomainEventBus;
  /** モーダルを開く前の目安チェックのみ(予約はしない、実際の消費判定はモーダル送信時のtryReserveRenameSlotで行う)。 */
  canRename: (channelId: string) => boolean;
}

async function replyOwnerOnly(interaction: ButtonInteraction): Promise<void> {
  await interaction.reply({ content: statusText("warning", "このVCのオーナーのみ操作できます。"), flags: MessageFlags.Ephemeral });
}

/**
 * permissionOverwrites.editは同じchannelオブジェクトを返すだけで、cacheはgatewayのCHANNEL_UPDATE
 * 受信まで古いまま。そのため呼び出し側はcacheを読み直さず、操作前の状態を反転してパネルを再描画する。
 */
async function toggleEveryoneOverwrite(
  voiceChannel: VoiceBasedChannel,
  permission: "Connect" | "ViewChannel",
  currentlyDenied: boolean,
): Promise<void> {
  suppressTempVoiceChannelLog(voiceChannel.id);
  try {
    await voiceChannel.permissionOverwrites.edit(
      voiceChannel.guild.roles.everyone.id,
      { [permission]: currentlyDenied ? null : false },
      { reason: TEMP_VOICE_UPDATE_REASON },
    );
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
    await interaction.reply({ content: statusText("warning", "このVCは既に削除されています。"), flags: MessageFlags.Ephemeral });
    return;
  }

  switch (parsed.action) {
    case "rename": {
      if (!deps.canRename(parsed.channelId)) {
        await interaction.reply({
          content: statusText("warning", "名前の変更回数が上限に達しました。しばらく待ってから再度お試しください。"),
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
      try {
        // オーナー自身がロックの影響を受けないよう、@everyoneへdenyを適用する前に個別許可を
        // 確定させる(#441、codexレビュー指摘: 逆順だとgrant失敗時に@everyoneのdenyだけが
        // 残り、直したかったオーナーロックアウトを再発させてしまう)。
        // VC作成時に既に付与済みの想定だが、作成前の既存VC向けの保険として毎回実行する。
        await grantOwnerVoiceAccess(voiceChannel, row.ownerId);
        await toggleEveryoneOverwrite(voiceChannel, "Connect", before.isLocked);
      } catch (error) {
        await interaction.followUp({ content: statusText("failed", "ロック状態の変更に失敗しました。時間を置いて再度お試しください。"), flags: MessageFlags.Ephemeral });
        throw error;
      }
      await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
        components: [buildControlPanelContainer(voiceChannel.id, row.ownerId, { ...before, isLocked: !before.isLocked })],
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
      try {
        // オーナー自身が非表示の影響を受けないよう、@everyoneへdenyを適用する前に個別許可を
        // 確定させる(#441、codexレビュー指摘: 逆順だとgrant失敗時に@everyoneのdenyだけが
        // 残り、直したかったオーナーロックアウトを再発させてしまう)。
        // VC作成時に既に付与済みの想定だが、作成前の既存VC向けの保険として毎回実行する。
        await grantOwnerVoiceAccess(voiceChannel, row.ownerId);
        await toggleEveryoneOverwrite(voiceChannel, "ViewChannel", before.isHidden);
      } catch (error) {
        await interaction.followUp({ content: statusText("failed", "表示状態の変更に失敗しました。時間を置いて再度お試しください。"), flags: MessageFlags.Ephemeral });
        throw error;
      }
      await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
        components: [buildControlPanelContainer(voiceChannel.id, row.ownerId, { ...before, isHidden: !before.isHidden })],
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
    case "transferOwner": {
      const membersInChannel = [...voiceChannel.members.values()].filter(
        (member: GuildMember) => member.id !== interaction.user.id,
      );
      await interaction.reply(buildTransferOwnerMessage(parsed.channelId, membersInChannel));
      return;
    }
  }
}
