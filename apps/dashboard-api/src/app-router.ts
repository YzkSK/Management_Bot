import { capabilityGrantsRouter, protectedProcedure, router } from "@management-bot/dashboard-access";
import { activityRouter } from "@management-bot/activity";
import { loggingRouter } from "@management-bot/logging";
import { moderationRouter } from "@management-bot/moderation";
import { tempVoiceRouter } from "@management-bot/temp-voice";
import { guildSettingsRouter } from "./routers/guild-settings.js";
import { createStatusRouter, resolveStatusAccess, type StatusDeps } from "./routers/status.js";

export function createAppRouter(statusDeps: StatusDeps) {
  return router({
    me: protectedProcedure.query(async ({ ctx }) => {
      const [avatarUrl, statusAccess] = await Promise.all([
        ctx.getMyAvatarUrl(),
        resolveStatusAccess(ctx.db, statusDeps, ctx.discordUserId),
      ]);
      return { discordUserId: ctx.discordUserId, discordUsername: ctx.discordUsername, avatarUrl, statusAccess };
    }),
    guildSettings: guildSettingsRouter,
    activity: activityRouter,
    logging: loggingRouter,
    moderation: moderationRouter,
    tempVoice: tempVoiceRouter,
    access: capabilityGrantsRouter,
    status: createStatusRouter(statusDeps),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;
