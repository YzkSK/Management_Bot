import type { FeatureModuleContext } from "@management-bot/core";
import { handleModerationEvent } from "../application/index.js";
import { registerMessageHandlers } from "./handlers/message.js";
import { registerMemberHandlers } from "./handlers/member.js";
import { registerRoleHandlers } from "./handlers/role.js";
import { registerChannelHandlers } from "./handlers/channel.js";
import { createSendToChannel } from "./send-to-channel.js";

export { createSendToChannel } from "./send-to-channel.js";

/**
 * moderation.action.recordedをmoderationFeatureModuleのconsumer groupではなく
 * logging自身のconsumer group(FeatureModuleContext.eventBus)で購読する。
 * 機能間連携はdomain-events経由のみで行い、moderationパッケージを直接importしない。
 * subscribeはRedis接続・consumer group作成に失敗し得るため、呼び出し元
 * (BotClient.registerFeatures)が起動失敗として検知できるようawaitする。
 *
 * discord.js自体のゲートウェイイベント(メッセージ作成等)はカテゴリ単位でhandlers/配下に分割し、
 * ここではその登録関数を呼び出すだけに留める(discord層を薄く保つ)。
 */
export async function registerDiscordHandlers(ctx: FeatureModuleContext): Promise<void> {
  const sendToChannel = createSendToChannel(ctx);
  await ctx.eventBus.subscribe(
    "moderation.action.recorded",
    handleModerationEvent({ db: ctx.db, sendToChannel }),
  );

  registerMessageHandlers(ctx);
  registerMemberHandlers(ctx);
  registerRoleHandlers(ctx);
  registerChannelHandlers(ctx);
}
