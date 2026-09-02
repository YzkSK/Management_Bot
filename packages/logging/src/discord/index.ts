import type { FeatureModuleContext } from "@management-bot/core";
import { handleModerationEvent } from "../application/index.js";
import { registerMessageHandlers } from "./handlers/message.js";
import { registerMemberHandlers } from "./handlers/member.js";
import { registerRoleHandlers } from "./handlers/role.js";
import { registerChannelHandlers } from "./handlers/channel.js";
import { registerGuildHandlers } from "./handlers/guild.js";
import { registerThreadHandlers } from "./handlers/thread.js";
import { registerInviteHandlers } from "./handlers/invite.js";
import { registerEmojiHandlers } from "./handlers/emoji.js";
import { registerAutoModHandlers } from "./handlers/auto-mod.js";
import { registerPollHandlers } from "./handlers/poll.js";
import { registerScheduledEventHandlers } from "./handlers/scheduled-event.js";
import { registerStageHandlers } from "./handlers/stage.js";
import { registerAuditLogCorrelationHandlers } from "./handlers/audit-log-correlation.js";
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
  registerGuildHandlers(ctx);
  registerThreadHandlers(ctx);
  registerInviteHandlers(ctx);
  registerEmojiHandlers(ctx);
  registerAutoModHandlers(ctx);
  registerPollHandlers(ctx);
  registerScheduledEventHandlers(ctx);
  registerStageHandlers(ctx);
  registerAuditLogCorrelationHandlers(ctx);
}
