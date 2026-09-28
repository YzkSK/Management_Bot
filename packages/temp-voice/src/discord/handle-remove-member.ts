import type { DomainEventBus } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import { TEMP_VOICE_UPDATE_REASON, shouldSuppressTempVoiceChannelLog, suppressTempVoiceChannelLog } from "@management-bot/shared";
import { deletePermissionOverride, findTempVoiceChannel } from "../application/index.js";
import { buildRemoveMemberSuccessMessage, parseRemoveMemberCustomId } from "./member-list-message.js";
import { MessageFlags, type ButtonInteraction, type VoiceBasedChannel } from "discord.js";

export interface HandleRemoveMemberDeps {
  db: Db;
  eventBus: DomainEventBus;
}

async function replyOwnerOnly(interaction: ButtonInteraction): Promise<void> {
  await interaction.reply({ content: "このVCのオーナーのみ操作できます。", flags: MessageFlags.Ephemeral });
}

/**
 * メンバー管理一覧の「解除」ボタン(#409)を処理する。DBレコードとDiscord個別overwriteの
 * Connectキーの両方をクリアし、`@everyone`のlock/hide設定にフォールバックさせる(Connect未設定に
 * 戻れば、Discordのパーミッション評価が自動的に@everyone側の設定を適用するため、追加処理は不要)。
 * permissionOverwrites.delete(overwrite全体の削除)ではなくedit({Connect: null})を使う
 * (codexレビュー指摘: deleteだと一時VC以外の目的でこのtargetに設定された他のoverwriteキーも
 * 巻き込んで消してしまう。個別許可・拒否はConnectキーのみを操作する設計のため、editで対称にする)。
 */
export async function handleTempVoiceRemoveMember(
  deps: HandleRemoveMemberDeps,
  interaction: ButtonInteraction,
): Promise<void> {
  const parsed = parseRemoveMemberCustomId(interaction.customId);
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

  await interaction.deferUpdate();

  suppressTempVoiceChannelLog(voiceChannel.id);
  try {
    await (voiceChannel as VoiceBasedChannel).permissionOverwrites.edit(
      parsed.targetId,
      { Connect: null },
      { reason: TEMP_VOICE_UPDATE_REASON },
    );
  } catch (error) {
    // API呼び出し自体が失敗した場合、抑制エントリが消費されないまま30秒残り、
    // 無関係な次のchannelUpdateを誤って抑制してしまう(codexレビュー指摘)。ここで消費して無効化する。
    shouldSuppressTempVoiceChannelLog(voiceChannel.id);
    await interaction.followUp({ content: "解除に失敗しました。時間を置いて再度お試しください。", flags: MessageFlags.Ephemeral });
    throw error;
  }

  await deletePermissionOverride(deps.db, parsed.channelId, parsed.targetType, parsed.targetId);

  const targetName =
    parsed.targetType === "user"
      ? interaction.guild?.members.cache.get(parsed.targetId)?.displayName
      : interaction.guild?.roles.cache.get(parsed.targetId)?.name;

  await interaction.editReply(buildRemoveMemberSuccessMessage());

  await deps.eventBus.publish({
    type: "temp-voice.event.recorded",
    action: "memberPermissionChanged",
    guildId: row.guildId,
    channelId: parsed.channelId,
    executorId: interaction.user.id,
    executorName: interaction.user.displayName,
    state: "cleared",
    targetType: parsed.targetType,
    targetId: parsed.targetId,
    targetName,
    createdAt: new Date().toISOString(),
  });
}
