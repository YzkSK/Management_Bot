import type { FeatureModuleContext } from "@management-bot/core";
import { MessageFlags } from "discord.js";
import type { ChannelMessage, ChannelSender } from "../application/index.js";

/**
 * チャンネル未存在・非テキスト・送信権限なしはすべて例外にする。
 * silentにreturnするとDomainEventBusがXACKして再配送されなくなり、
 * ログがチャンネルへ届かないまま欠落する(#47コードレビュー参照)。
 * チャンネル削除等の恒久的な設定不備で再送が繰り返される場合は、
 * DomainEventBusのonErrorに通知されるためそちらで監視・対処する。
 *
 * message.componentsが指定されている場合はComponents V2 (MessageFlags.IsComponentsV2)で送る。
 * このフラグはcontentと併用できない(Discord API仕様)ため、components指定時はcontentを送らない。
 */
export function createSendToChannel(ctx: FeatureModuleContext): ChannelSender {
  return async (channelId: string, message: ChannelMessage) => {
    const channel = await ctx.client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !channel.isSendable()) {
      throw new Error(`Channel ${channelId} is not a sendable text-based channel`);
    }
    const allowedMentions = message.suppressMentions ? { parse: [] } : undefined;
    if (message.components) {
      await channel.send({
        components: message.components,
        flags: MessageFlags.IsComponentsV2,
        allowedMentions,
      });
      return;
    }
    await channel.send({ content: message.content, allowedMentions });
  };
}
