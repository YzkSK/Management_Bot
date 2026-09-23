import type { FeatureModuleContext } from "@management-bot/core";
import { handleVoiceCreate } from "./voice-create.js";

export function registerDiscordHandlers(ctx: FeatureModuleContext): void {
  const deps = { db: ctx.db, eventBus: ctx.eventBus };

  ctx.client.on("voiceStateUpdate", (_oldState, newState) => {
    handleVoiceCreate(deps, newState).catch((error: unknown) => {
      console.error("temp-voice: failed to handle voiceStateUpdate (Join to Create)", error);
    });
  });
}
