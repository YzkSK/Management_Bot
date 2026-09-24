import type { DomainEventBus } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import { findOwnedTempVoiceChannelId, findTempVoiceChannel, transferTempVoiceOwner } from "../application/index.js";
import { buildControlPanelContainer, readTempVoiceState } from "./control-panel-message.js";
import { editControlChannelViewer, rollbackGrantedViewerIfNotOwner } from "./control-channel-permission.js";
import { parseTransferOwnerSelectCustomId } from "./transfer-owner-message.js";
import { MessageFlags, type StringSelectMenuInteraction, type VoiceBasedChannel } from "discord.js";

export interface HandleTransferOwnerDeps {
  db: Db;
  eventBus: DomainEventBus;
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
    await interaction.reply({ content: "このVCのオーナーのみ操作できます。", flags: MessageFlags.Ephemeral });
    return;
  }

  const voiceChannel = interaction.guild?.channels.cache.get(parsed.channelId);
  if (!voiceChannel?.isVoiceBased()) {
    await interaction.reply({ content: "このVCは既に削除されています。", flags: MessageFlags.Ephemeral });
    return;
  }

  const newOwnerId = interaction.values[0];
  if (!newOwnerId) return;

  const newOwnerMember = voiceChannel.members.get(newOwnerId);
  if (!newOwnerMember) {
    await interaction.reply({ content: "選択されたメンバーは既にVCから退出しています。", flags: MessageFlags.Ephemeral });
    return;
  }

  // 移譲先が既に別の一時VCのオーナーだと、guildId+ownerIdのunique制約(#406)によりDB更新が
  // 例外になる。権限付与前に弾くことで無駄なロールバックを避ける(codexレビュー指摘:
  // 完全な対策はtransferTempVoiceOwnerの制約違反ハンドリング側、これは事前チェックによる高速失敗)。
  if (await findOwnedTempVoiceChannelId(deps.db, row.guildId, newOwnerId)) {
    await interaction.reply({ content: "選択されたメンバーは既に別の一時VCのオーナーです。", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();

  const client = interaction.client;
  try {
    await editControlChannelViewer(client, row.controlChannelId, newOwnerId, true);
  } catch (error) {
    await interaction.followUp({ content: "オーナー移譲に失敗しました。時間を置いて再度お試しください。", flags: MessageFlags.Ephemeral });
    throw error;
  }

  let result: Awaited<ReturnType<typeof transferTempVoiceOwner>>;
  try {
    result = await transferTempVoiceOwner(deps.db, voiceChannel.id, row.ownerId, newOwnerId);
  } catch (error) {
    // unique制約違反以外のDBエラー(接続断等)。付与済みの権限をDBの現オーナーで確認しつつロールバック
    // する(codexレビュー指摘: 例外がそのまま伝播すると付与済み権限が孤立して残ってしまう)。
    await rollbackGrantedViewerIfNotOwner(deps.db, client, voiceChannel.id, row.controlChannelId, newOwnerId).catch(
      (rollbackError: unknown) => {
        console.error(`temp-voice: failed to roll back control channel permission for ${voiceChannel.id} after DB error`, rollbackError);
      },
    );
    await interaction.followUp({ content: "オーナー移譲に失敗しました。時間を置いて再度お試しください。", flags: MessageFlags.Ephemeral });
    throw error;
  }
  if (result !== "committed") {
    // "lostRace": 自動再割当cronが先にオーナーを変更済み(codexレビュー指摘: 手動移譲とcronの競合)。
    // "newOwnerAlreadyOwnsChannel": 事前チェックをすり抜けたrace conditionで移譲先が別VCの
    // オーナーになっていた(codexレビュー指摘)。いずれもDBの現オーナーを再確認してから付与した
    // 閲覧権限を戻す(codexレビュー指摘: 無条件に剥奪すると、cron側が同じ候補者を新オーナーに
    // 選んでいた場合に正当な権限を奪ってしまう)。
    await rollbackGrantedViewerIfNotOwner(deps.db, client, voiceChannel.id, row.controlChannelId, newOwnerId).catch((error: unknown) => {
      console.error(`temp-voice: failed to roll back control channel permission for ${voiceChannel.id} after ${result}`, error);
    });
    const content =
      result === "newOwnerAlreadyOwnsChannel"
        ? "オーナー移譲に失敗しました。選択されたメンバーは既に別の一時VCのオーナーです。"
        : "オーナー移譲に失敗しました。既に他の処理でオーナーが変更されている可能性があります。";
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    return;
  }

  await editControlChannelViewer(client, row.controlChannelId, row.ownerId, null).catch((error: unknown) => {
    // DB更新は既に確定しているため、旧オーナーの権限剥奪失敗は握りつぶしログのみ(孤立した閲覧権限が残るだけで実害は小さい)。
    console.error(`temp-voice: failed to revoke previous owner control channel permission for ${voiceChannel.id}`, error);
  });

  await interaction.editReply({
    flags: MessageFlags.IsComponentsV2,
    components: [buildControlPanelContainer(voiceChannel.id, readTempVoiceState(voiceChannel as VoiceBasedChannel))],
  });

  await deps.eventBus.publish({
    type: "temp-voice.event.recorded",
    action: "ownerTransferred",
    guildId: row.guildId,
    channelId: voiceChannel.id,
    executorId: interaction.user.id,
    executorName: interaction.user.displayName,
    previousOwnerId: row.ownerId,
    previousOwnerName: interaction.user.displayName,
    newOwnerId,
    newOwnerName: newOwnerMember.displayName,
    trigger: "manual",
    createdAt: new Date().toISOString(),
  });
}
