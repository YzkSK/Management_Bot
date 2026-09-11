import { capabilityGrantsRouter, protectedProcedure, router } from "@management-bot/dashboard-access";
import { activityRouter } from "@management-bot/activity";
import { loggingRouter } from "@management-bot/logging";
import { moderationRouter } from "@management-bot/moderation";
import { guildSettingsRouter } from "./routers/guild-settings.js";

// temp-voiceはdomain/application/discord/router層が空スタブのままのため、
// tRPC名前空間としての公開は実装着手時まで見送る(issue #222)。パッケージ自体・
// feature-moduleへの登録は将来機能の予約枠として残す。
export const appRouter = router({
  me: protectedProcedure.query(({ ctx }) => ({
    discordUserId: ctx.discordUserId,
    discordUsername: ctx.discordUsername,
  })),
  guildSettings: guildSettingsRouter,
  activity: activityRouter,
  logging: loggingRouter,
  moderation: moderationRouter,
  access: capabilityGrantsRouter,
});

export type AppRouter = typeof appRouter;
