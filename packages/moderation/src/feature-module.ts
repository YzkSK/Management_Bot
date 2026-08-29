import type { FeatureModule } from "@management-bot/core";
import { registerDiscordHandlers } from "./discord/index.js";
import { moderationRouter } from "./router/index.js";

export const moderationFeatureModule: FeatureModule = {
  key: "moderation",
  registerDiscordHandlers,
  router: moderationRouter,
};
