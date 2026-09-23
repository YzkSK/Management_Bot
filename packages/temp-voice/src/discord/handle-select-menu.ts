import type { DomainEventBus } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import { TEMP_VOICE_UPDATE_REASON, suppressTempVoiceChannelLog } from "@management-bot/shared";
import {
  findTempVoiceChannel,
  isDenyProtectedRole,
  upsertPermissionOverride,
  type TempVoicePermissionTargetType,
} from "../application/index.js";
import { buildControlPanelContainer, readTempVoiceState } from "./control-panel-message.js";
import { parseTempVoiceSelectCustomId } from "./select-permission-message.js";
import {
  MessageFlags,
  type GuildMember,
  type RoleSelectMenuInteraction,
  type UserSelectMenuInteraction,
  type VoiceBasedChannel,
} from "discord.js";

export interface HandleSelectMenuDeps {
  db: Db;
  eventBus: DomainEventBus;
}

async function replyOwnerOnly(interaction: RoleSelectMenuInteraction | UserSelectMenuInteraction): Promise<void> {
  await interaction.reply({ content: "このVCのオーナーのみ操作できます。", flags: MessageFlags.Ephemeral });
}

/** ロール拒否時、対象ロールを持つVC内メンバー全員を切断する(issueの指示)。 */
async function kickMembersWithRole(voiceChannel: VoiceBasedChannel, roleId: string): Promise<void> {
  const membersInChannel = voiceChannel.members;
  const targets = membersInChannel.filter((member: GuildMember) => member.roles.cache.has(roleId));
  await Promise.all(
    [...targets.values()].map((member: GuildMember) =>
      member.voice.disconnect(TEMP_VOICE_UPDATE_REASON).catch((error: unknown) => {
        console.error(`temp-voice: failed to disconnect member ${member.id} for role deny`, error);
      }),
    ),
  );
}

/**
 * 個別許可・拒否のセレクトメニュー送信(#409)を処理する。ユーザー/ロールいずれも同じ流れ:
 * オーナーチェック→(拒否のみ)保護ロール判定→DB UPSERT→Discord個別overwrite付与
 * →(拒否×ロールのみ)対象ロール保持者を即kick→制御パネル再描画→domain-events publish。
 */
export async function handleTempVoiceSelectMenu(
  deps: HandleSelectMenuDeps,
  interaction: RoleSelectMenuInteraction | UserSelectMenuInteraction,
): Promise<void> {
  const parsed = parseTempVoiceSelectCustomId(interaction.customId);
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

  const targetType: TempVoicePermissionTargetType =
    parsed.action === "permitMemberUser" || parsed.action === "denyMemberUser" ? "user" : "role";
  const state: "allow" | "deny" = parsed.action === "permitMemberUser" || parsed.action === "permitMemberRole" ? "allow" : "deny";
  const targetId = interaction.values[0];
  if (!targetId) return;

  if (state === "deny" && targetType === "role") {
    if (await isDenyProtectedRole(deps.db, row.guildId, targetId)) {
      await interaction.reply({
        content: "このロールは拒否指定できません(サーバー管理者が保護しています)。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  await interaction.deferUpdate();

  suppressTempVoiceChannelLog(voiceChannel.id);
  let updatedChannel: VoiceBasedChannel;
  try {
    updatedChannel = (await voiceChannel.permissionOverwrites.edit(
      targetId,
      state === "allow" ? { Connect: true } : { Connect: false },
      { reason: TEMP_VOICE_UPDATE_REASON },
    )) as VoiceBasedChannel;
  } catch (error) {
    await interaction.followUp({ content: "権限の変更に失敗しました。時間を置いて再度お試しください。", flags: MessageFlags.Ephemeral });
    throw error;
  }

  await upsertPermissionOverride(deps.db, { channelId: voiceChannel.id, targetType, targetId, state });

  if (state === "deny") {
    if (targetType === "user") {
      const member = interaction.guild?.members.cache.get(targetId);
      if (member?.voice.channelId === voiceChannel.id) {
        await member.voice.disconnect(TEMP_VOICE_UPDATE_REASON).catch((error: unknown) => {
          console.error(`temp-voice: failed to disconnect member ${targetId} for user deny`, error);
        });
      }
    } else {
      await kickMembersWithRole(updatedChannel, targetId);
    }
  }

  await interaction.editReply({
    flags: MessageFlags.IsComponentsV2,
    components: [buildControlPanelContainer(voiceChannel.id, readTempVoiceState(updatedChannel))],
  });

  const targetName =
    targetType === "user"
      ? interaction.guild?.members.cache.get(targetId)?.displayName
      : interaction.guild?.roles.cache.get(targetId)?.name;

  await deps.eventBus.publish({
    type: "temp-voice.event.recorded",
    action: "memberPermissionChanged",
    guildId: row.guildId,
    channelId: voiceChannel.id,
    executorId: interaction.user.id,
    executorName: interaction.user.displayName,
    state,
    targetType,
    targetId,
    targetName,
    createdAt: new Date().toISOString(),
  });
}
