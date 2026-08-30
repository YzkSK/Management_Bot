import { describe, expect, test } from "bun:test";
import { BotClient } from "@management-bot/core";
import { moderationFeatureModule } from "./feature-module.js";

describe("moderationFeatureModule", () => {
  test("keyがmoderationである", () => {
    expect(moderationFeatureModule.key).toBe("moderation");
  });

  test("registerDiscordHandlersはエラーなく実行できる(空実装)", async () => {
    const client = new BotClient();
    await expect(
      Promise.resolve(moderationFeatureModule.registerDiscordHandlers({ client })),
    ).resolves.toBeUndefined();
  });
});
