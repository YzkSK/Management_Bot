import { describe, expect, test } from "bun:test";
import { BotClient } from "@management-bot/core";
import { activityFeatureModule } from "./feature-module.js";

describe("activityFeatureModule", () => {
  test("keyがactivityである", () => {
    expect(activityFeatureModule.key).toBe("activity");
  });

  test("registerDiscordHandlersはエラーなく実行できる(空実装)", async () => {
    const client = new BotClient();
    await expect(
      Promise.resolve(activityFeatureModule.registerDiscordHandlers({ client })),
    ).resolves.toBeUndefined();
  });
});
