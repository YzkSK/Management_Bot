import type { FeatureModule } from "@management-bot/core";
import { registerDiscordHandlers } from "./discord/index.js";
import { tempVoiceRouter } from "./router/index.js";

export const tempVoiceFeatureModule: FeatureModule = {
  key: "temp-voice",
  registerDiscordHandlers,
  router: tempVoiceRouter,
};
