import { describe, expect, test } from "bun:test";
import { BotClient } from "@management-bot/core";
import { tempVoiceFeatureModule } from "./feature-module.js";

describe("tempVoiceFeatureModule", () => {
  test("keyがtemp-voiceである", () => {
    expect(tempVoiceFeatureModule.key).toBe("temp-voice");
  });

  test("registerDiscordHandlersはエラーなく実行できる(空実装)", async () => {
    const client = new BotClient();
    await expect(
      Promise.resolve(tempVoiceFeatureModule.registerDiscordHandlers({ client })),
    ).resolves.toBeUndefined();
  });
});
