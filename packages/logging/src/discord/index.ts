import type { FeatureModuleContext } from "@management-bot/core";
import { listenForLogChannelSettingChanges } from "@management-bot/db";
import { LOG_CATEGORIES } from "@management-bot/shared";
import { createChannelSettingResolver, handleModerationEvent } from "../application/index.js";
import { registerMessageHandlers } from "./handlers/message.js";
import { registerReactionHandlers } from "./handlers/reaction.js";
import { registerMemberHandlers } from "./handlers/member.js";
import { registerRoleHandlers } from "./handlers/role.js";
import { registerChannelHandlers } from "./handlers/channel.js";
import { registerGuildHandlers } from "./handlers/guild.js";
import { registerThreadHandlers } from "./handlers/thread.js";
import { registerInviteHandlers } from "./handlers/invite.js";
import { registerEmojiHandlers } from "./handlers/emoji.js";
import { registerStickerHandlers } from "./handlers/sticker.js";
import { registerAutoModHandlers } from "./handlers/auto-mod.js";
import { registerPollHandlers } from "./handlers/poll.js";
import { registerScheduledEventHandlers } from "./handlers/scheduled-event.js";
import { registerStageHandlers } from "./handlers/stage.js";
import { registerAuditLogCorrelationHandlers } from "./handlers/audit-log-correlation.js";
import { registerVoiceHandlers } from "./handlers/voice.js";
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
  // guild×categoryの出力先チャンネル設定は全ハンドラで共通のTTLキャッシュを共有する
  // (ハンドラごとに別インスタンスを作ると重複問い合わせが解消されないため、ここで1つだけ生成する)。
  const getChannelId = createChannelSettingResolver(ctx.db);
  // dashboard-api(別プロセス)でのchannel設定変更をTTL満了前に反映するため、
  // DBトリガー(migrations/0013)のpg_notifyをLISTENしてキャッシュを即時invalidateする。
  // 購読自体の失敗はログ出力のみに留め、TTL経由の最終的な反映(createChannelSettingResolver
  // のデフォルト5秒)にフォールバックさせる(bot起動をブロックしない)。
  const channelSettingNotifications = listenForLogChannelSettingChanges(ctx.databaseUrl, ({ guildId, category }) => {
    if (!(LOG_CATEGORIES as readonly string[]).includes(category)) return;
    getChannelId.invalidate?.(guildId, category as (typeof LOG_CATEGORIES)[number]);
  });
  channelSettingNotifications.ready.catch((error: unknown) => {
    console.error("Failed to listen for log_channel_settings changes (cache invalidation disabled)", error);
  });

  await ctx.eventBus.subscribe(
    "moderation.action.recorded",
    handleModerationEvent({ db: ctx.db, sendToChannel, getChannelId }),
  );

  registerMessageHandlers(ctx, getChannelId);
  registerReactionHandlers(ctx, getChannelId);
  registerMemberHandlers(ctx, getChannelId);
  registerRoleHandlers(ctx, getChannelId);
  registerChannelHandlers(ctx, getChannelId);
  registerGuildHandlers(ctx, getChannelId);
  registerThreadHandlers(ctx, getChannelId);
  registerInviteHandlers(ctx, getChannelId);
  registerEmojiHandlers(ctx, getChannelId);
  registerStickerHandlers(ctx, getChannelId);
  registerAutoModHandlers(ctx, getChannelId);
  registerPollHandlers(ctx, getChannelId);
  registerScheduledEventHandlers(ctx, getChannelId);
  registerStageHandlers(ctx, getChannelId);
  registerAuditLogCorrelationHandlers(ctx, getChannelId);
  registerVoiceHandlers(ctx, getChannelId);
}
