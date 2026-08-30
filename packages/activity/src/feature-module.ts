import type { FeatureModule } from "@management-bot/core";
import { registerDiscordHandlers } from "./discord/index.js";
import { activityRouter } from "./router/index.js";

export const activityFeatureModule: FeatureModule = {
  key: "activity",
  registerDiscordHandlers,
  router: activityRouter,
};
