import type { FeatureModule } from "@management-bot/core";
import { registerDiscordHandlers } from "./discord/index.js";
import { scheduledPostRouter } from "./router/index.js";

export const scheduledPostFeatureModule: FeatureModule = {
  key: "scheduled-post",
  registerDiscordHandlers,
  router: scheduledPostRouter,
};
