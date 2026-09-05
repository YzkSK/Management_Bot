import { protectedProcedure, router } from "@management-bot/dashboard-access";

export const guildSettingsRouter = router({
  listMyGuilds: protectedProcedure.query(({ ctx }) => ctx.listMyGuilds()),
});
