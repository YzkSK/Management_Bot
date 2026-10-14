import type { DomainEventBus } from "@management-bot/core";
import { withResourceLock as withResourceLockDefault, type Db } from "@management-bot/db";
import { findOwnedTempVoiceChannelId, findTempVoiceChannel } from "../application/index.js";
import { buildControlPanelContainer, readTempVoiceState } from "./control-panel-message.js";
import { executeOwnerTransfer } from "./execute-owner-transfer.js";
import { parseTransferOwnerSelectCustomId } from "./transfer-owner-message.js";
import { MessageFlags, type StringSelectMenuInteraction, type VoiceBasedChannel } from "discord.js";
import { statusText } from "./status-text.js";

export interface HandleTransferOwnerDeps {
  db: Db;
  eventBus: DomainEventBus;
  /** テスト時に差し替え可能にするため注入する(デフォルトは@management-bot/dbの実装、run-grace.ts参照)。 */
  withResourceLock?: typeof withResourceLockDefault;
}

/**
 * オーナー移譲(手動)のセレクトメニュー送信を処理する(#410)。
 * オーナーチェック→移譲先がまだVC内にいるか再検証(セレクト表示後に退出した可能性があるため)
 * →制御チャンネルの閲覧権限を新オーナーへ付け替え→DB更新(compare-and-swapで猶予情報も同時に
 * クリア。自動再割当cronと同時に走った場合、後から実行される側のCASが0行更新となり二重移譲を
 * 防ぐ。codexレビュー指摘)→制御パネル再描画→temp-voice.event.recorded(action=ownerTransferred,
 * trigger=manual)をpublish。
 */
export async function handleTempVoiceTransferOwner(deps: HandleTransferOwnerDeps, interaction: StringSelectMenuInteraction): Promise<void> {
  const parsed = parseTransferOwnerSelectCustomId(interaction.customId);
  if (!parsed) return;

  const row = await findTempVoiceChannel(deps.db, parsed.channelId);
  if (!row || row.ownerId !== interaction.user.id) {
    await interaction.reply({ content: statusText("warning", "このVCのオーナーのみ操作できます。"), flags: MessageFlags.Ephemeral });
    return;
  }

  const voiceChannel = interaction.guild?.channels.cache.get(parsed.channelId);
  if (!voiceChannel?.isVoiceBased()) {
    await interaction.reply({ content: statusText("warning", "このVCは既に削除されています。"), flags: MessageFlags.Ephemeral });
    return;
  }

  const newOwnerId = interaction.values[0];
  if (!newOwnerId) return;

  const newOwnerMember = voiceChannel.members.get(newOwnerId);
  if (!newOwnerMember) {
    await interaction.reply({ content: statusText("warning", "選択されたメンバーは既にVCから退出しています。"), flags: MessageFlags.Ephemeral });
    return;
  }

  // 移譲先が既に別の一時VCのオーナーだと、guildId+ownerIdのunique制約(#406)によりDB更新が
  // 例外になる。権限付与前に弾くことで無駄なロールバックを避ける(codexレビュー指摘:
  // 完全な対策はtransferTempVoiceOwnerの制約違反ハンドリング側、これは事前チェックによる高速失敗)。
  if (await findOwnedTempVoiceChannelId(deps.db, row.guildId, newOwnerId)) {
    await interaction.reply({ content: statusText("warning", "選択されたメンバーは既に別の一時VCのオーナーです。"), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();

  await executeOwnerTransfer({
    db: deps.db,
    client: interaction.client,
    eventBus: deps.eventBus,
    withResourceLock: deps.withResourceLock,
    row,
    voiceChannel,
    newOwnerMember,
    executor: { id: interaction.user.id, name: interaction.user.displayName },
    previousOwnerName: interaction.user.displayName,
    onFailure: async (content) => {
      await interaction.followUp({ content: statusText("failed", content), flags: MessageFlags.Ephemeral });
    },
    refreshPanel: async () => {
      await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
        components: [buildControlPanelContainer(voiceChannel.id, newOwnerMember.id, readTempVoiceState(voiceChannel as VoiceBasedChannel))],
      });
    },
  });
}
