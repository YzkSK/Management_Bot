import { describe, expect, test } from "bun:test";
import { BotClient } from "@management-bot/core";
import { loggingFeatureModule } from "./feature-module.js";

describe("loggingFeatureModule", () => {
  test("keyがloggingである", () => {
    expect(loggingFeatureModule.key).toBe("logging");
  });

  test("registerDiscordHandlersはエラーなく実行できる(空実装)", async () => {
    const client = new BotClient();
    await expect(
      Promise.resolve(loggingFeatureModule.registerDiscordHandlers({ client })),
    ).resolves.toBeUndefined();
  });
});
