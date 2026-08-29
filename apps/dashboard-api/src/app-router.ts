import { protectedProcedure, router } from "@management-bot/dashboard-access";
import { activityRouter } from "@management-bot/activity";
import { loggingRouter } from "@management-bot/logging";
import { tempVoiceRouter } from "@management-bot/temp-voice";
import { moderationRouter } from "@management-bot/moderation";
import { guildSettingsRouter } from "./routers/guild-settings.js";

export const appRouter = router({
  me: protectedProcedure.query(({ ctx }) => ({ discordUserId: ctx.discordUserId })),
  guildSettings: guildSettingsRouter,
  activity: activityRouter,
  logging: loggingRouter,
  tempVoice: tempVoiceRouter,
  moderation: moderationRouter,
});

export type AppRouter = typeof appRouter;
