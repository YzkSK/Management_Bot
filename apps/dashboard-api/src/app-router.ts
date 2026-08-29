import { protectedProcedure, router } from "@management-bot/dashboard-access";
import { guildSettingsRouter } from "./routers/guild-settings.js";

export const appRouter = router({
  me: protectedProcedure.query(({ ctx }) => ({ discordUserId: ctx.discordUserId })),
  guildSettings: guildSettingsRouter,
});

export type AppRouter = typeof appRouter;
