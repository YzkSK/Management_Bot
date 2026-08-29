import { router } from "@management-bot/dashboard-access";
import { guildSettingsRouter } from "./routers/guild-settings.js";

export const appRouter = router({
  guildSettings: guildSettingsRouter,
});

export type AppRouter = typeof appRouter;
