import type { FeatureModule } from "@management-bot/core";
import { registerDiscordHandlers } from "./discord/index.js";
import { loggingRouter } from "./router/index.js";

export const loggingFeatureModule: FeatureModule = {
  key: "logging",
  registerDiscordHandlers,
  router: loggingRouter,
};
