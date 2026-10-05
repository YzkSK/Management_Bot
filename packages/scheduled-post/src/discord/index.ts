import type { FeatureModuleContext } from "@management-bot/core";
import { registerDashboardActionListener } from "./dashboard-action-listener.js";
import { createEventPublisher } from "./events.js";
import { createDiscordGateway } from "./gateway.js";
import { registerScheduleCommand } from "./schedule-command.js";
import { createScheduler } from "./scheduler.js";

export function registerDiscordHandlers(ctx: FeatureModuleContext): void {
  const publish = createEventPublisher(ctx.eventBus);

  registerScheduleCommand({ ctx, publish });

  // Dashboardでの管理者取り消し後のDM・ログ発行(pg_notifyを起動時に購読)。
  const dashboardActionListener = registerDashboardActionListener({
    db: ctx.db,
    publish,
    databaseUrl: ctx.databaseUrl,
    discord: {
      channelName: (channelId) => {
        const channel = ctx.client.channels.cache.get(channelId);
        return channel && !channel.isDMBased() && "name" in channel ? (channel.name ?? undefined) : undefined;
      },
      authorName: (userId) => ctx.client.users.cache.get(userId)?.displayName,
      sendDm: async (userId, text) => {
        const user = await ctx.client.users.fetch(userId);
        await user.send(text);
      },
    },
  });
  ctx.onShutdown(dashboardActionListener.close);

  // 予約の投稿はDiscord接続が必要なためBotプロセス内で15秒ごとに実行する。
  // 起動時のリカバリ(posting残留の失敗化)はクライアントがready後に1回だけ行う。
  const scheduler = createScheduler({ db: ctx.db, gateway: createDiscordGateway(ctx.client), publish });
  const start = () => {
    scheduler.start().catch((error: unknown) => {
      console.error("scheduled-post: failed to start scheduler", error);
    });
  };
  if (ctx.client.isReady()) start();
  else ctx.client.once("ready", start);
  ctx.onShutdown(scheduler.stop);
}
