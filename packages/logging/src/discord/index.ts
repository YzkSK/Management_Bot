import type { FeatureModuleContext } from "@management-bot/core";
import type { ChannelMessage, ChannelSender } from "../application/index.js";
import { handleModerationEvent } from "../application/index.js";

export function createSendToChannel(ctx: FeatureModuleContext): ChannelSender {
  return async (channelId: string, message: ChannelMessage) => {
    const channel = await ctx.client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !channel.isSendable()) return;
    await channel.send({
      content: message.content,
      allowedMentions: message.suppressMentions ? { parse: [] } : undefined,
    });
  };
}

/**
 * moderation.action.recordedをmoderationFeatureModuleのconsumer groupではなく
 * logging自身のconsumer group(FeatureModuleContext.eventBus)で購読する。
 * 機能間連携はdomain-events経由のみで行い、moderationパッケージを直接importしない。
 * subscribeはRedis接続・consumer group作成に失敗し得るため、呼び出し元
 * (BotClient.registerFeatures)が起動失敗として検知できるようawaitする。
 */
export async function registerDiscordHandlers(ctx: FeatureModuleContext): Promise<void> {
  const sendToChannel = createSendToChannel(ctx);
  await ctx.eventBus.subscribe(
    "moderation.action.recorded",
    handleModerationEvent({ db: ctx.db, sendToChannel }),
  );
}
