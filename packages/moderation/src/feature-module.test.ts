import { describe, expect, mock, test } from "bun:test";
import type { DomainEventBus, FeatureModuleContext } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import { moderationFeatureModule } from "./feature-module.js";

describe("moderationFeatureModule", () => {
  test("keyがmoderationである", () => {
    expect(moderationFeatureModule.key).toBe("moderation");
  });

  test("registerDiscordHandlersはエラーなく実行できる", () => {
    const on = mock(() => undefined);
    const ctx = {
      client: { on },
      db: {} as Db,
      databaseUrl: "postgres://invalid-test-host/db",
      redisUrl: "redis://invalid-test-host:6379",
      eventBus: {} as DomainEventBus,
      onShutdown: () => {},
    } as unknown as FeatureModuleContext;

    expect(() => moderationFeatureModule.registerDiscordHandlers(ctx)).not.toThrow();
    expect(on).toHaveBeenCalledWith("messageCreate", expect.any(Function));
  });
});
