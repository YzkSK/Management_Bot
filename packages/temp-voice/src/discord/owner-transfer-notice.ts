import { ChannelType, ContainerBuilder, MessageFlags, TextDisplayBuilder, type Client, type MessageCreateOptions, type VoiceBasedChannel } from "discord.js";
import { buildControlPanelContainer, buildTempVoiceCustomId, readTempVoiceState } from "./control-panel-message.js";

export type OwnerTransferTrigger = "manual" | "autoGraceExpired";

const NOTICE_HEADING = "## 👑 オーナー移譲";

/** オーナー移譲の通知メッセージ(#531)。新オーナーにだけメンション通知が飛ぶようallowedMentionsを絞る。 */
export function buildOwnerTransferNotice(previousOwnerId: string, newOwnerId: string, trigger: OwnerTransferTrigger): MessageCreateOptions {
  const body =
    trigger === "manual"
      ? `<@${previousOwnerId}> さんから <@${newOwnerId}> さんへオーナー権限が移譲されました。`
      : `前オーナー <@${previousOwnerId}> さんの不在が続いたため、<@${newOwnerId}> さんへオーナー権限が自動で移譲されました。`;
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`${NOTICE_HEADING}\n${body}`),
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container], allowedMentions: { users: [newOwnerId] } };
}

/**
 * 移譲確定後に制御チャンネルへ通知を送る(#531)。DB更新は確定済みのため失敗はログのみ。
 * voiceChannelを渡した場合は制御パネルも新オーナー表示に更新する(自動移譲はinteractionが無いため)。
 * 制御チャンネルは全員SendMessages denyのため、最古のメッセージ=制御パネルとみなす。
 */
export async function announceOwnerTransfer(
  client: Client,
  controlChannelId: string,
  previousOwnerId: string,
  newOwnerId: string,
  trigger: OwnerTransferTrigger,
  voiceChannel?: VoiceBasedChannel,
): Promise<void> {
  const controlChannel = client.channels.cache.get(controlChannelId);
  if (controlChannel?.type !== ChannelType.GuildText) return;
  if (voiceChannel) {
    try {
      const panel = (await controlChannel.messages.fetch({ after: "0", limit: 1 })).first();
      // 移譲通知等を誤ってパネルとして上書きしないよう、パネルのボタンcustomIdを含むかも確認する。
      const panelCustomId = buildTempVoiceCustomId("rename", voiceChannel.id);
      if (panel && panel.author.id === client.user?.id && JSON.stringify(panel.components).includes(panelCustomId)) {
        await panel.edit({
          flags: MessageFlags.IsComponentsV2,
          allowedMentions: { parse: [] },
          components: [buildControlPanelContainer(voiceChannel.id, newOwnerId, readTempVoiceState(voiceChannel))],
        });
      }
    } catch (error) {
      console.error(`temp-voice: failed to refresh control panel in ${controlChannelId}`, error);
    }
  }
  let sent;
  try {
    sent = await controlChannel.send(buildOwnerTransferNotice(previousOwnerId, newOwnerId, trigger));
  } catch (error) {
    console.error(`temp-voice: failed to announce owner transfer in ${controlChannelId}`, error);
    return; // 送信失敗時は旧通知を残し、通知ゼロにしない。
  }
  // 前回の移譲通知は古い情報になるため削除する。見出しで判定し、ボタンラベルに同語を持つパネルは除外する。
  try {
    const recent = await controlChannel.messages.fetch({ limit: 50 });
    for (const message of recent.values()) {
      if (message.id === sent.id || message.author.id !== client.user?.id) continue;
      if (!JSON.stringify(message.components).includes(NOTICE_HEADING)) continue;
      await message.delete().catch((error: unknown) => {
        console.error(`temp-voice: failed to delete previous owner transfer notice ${message.id}`, error);
      });
    }
  } catch (error) {
    console.error(`temp-voice: failed to fetch previous owner transfer notices in ${controlChannelId}`, error);
  }
}
