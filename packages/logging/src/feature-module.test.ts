import { describe, expect, test } from "bun:test";
import { BotClient } from "@management-bot/core";
import type { DomainEventBus } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import { loggingFeatureModule } from "./feature-module.js";

describe("loggingFeatureModule", () => {
  test("keyがloggingである", () => {
    expect(loggingFeatureModule.key).toBe("logging");
  });

  test("registerDiscordHandlersはmoderation.action.recordedを購読する", async () => {
    const client = new BotClient();
    const subscribe = () => Promise.resolve();
    const eventBus = { subscribe } as unknown as DomainEventBus;

    await expect(
      Promise.resolve(
        loggingFeatureModule.registerDiscordHandlers({ client, db: {} as Db, eventBus }),
      ),
    ).resolves.toBeUndefined();
  });
});
