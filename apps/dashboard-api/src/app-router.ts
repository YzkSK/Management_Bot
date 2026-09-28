import { capabilityGrantsRouter, protectedProcedure, router } from "@management-bot/dashboard-access";
import { activityRouter } from "@management-bot/activity";
import { loggingRouter } from "@management-bot/logging";
import { moderationRouter } from "@management-bot/moderation";
import { tempVoiceRouter } from "@management-bot/temp-voice";
import { guildSettingsRouter } from "./routers/guild-settings.js";

export const appRouter = router({
  me: protectedProcedure.query(async ({ ctx }) => ({
    discordUserId: ctx.discordUserId,
    discordUsername: ctx.discordUsername,
    avatarUrl: await ctx.getMyAvatarUrl(),
  })),
  guildSettings: guildSettingsRouter,
  activity: activityRouter,
  logging: loggingRouter,
  moderation: moderationRouter,
  tempVoice: tempVoiceRouter,
  access: capabilityGrantsRouter,
});

export type AppRouter = typeof appRouter;
