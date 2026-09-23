import { describe, expect, mock, test } from "bun:test";
import { BotClient, type DomainEventBus, type FeatureModuleContext } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import { tempVoiceFeatureModule } from "./feature-module.js";

describe("tempVoiceFeatureModule", () => {
  test("keyがtemp-voiceである", () => {
    expect(tempVoiceFeatureModule.key).toBe("temp-voice");
  });

  test("registerDiscordHandlersはvoiceStateUpdateハンドラを登録しエラーなく実行できる", async () => {
    const client = new BotClient();
    const on = mock(() => client);
    (client as unknown as { on: typeof on }).on = on;
    const ctx: FeatureModuleContext = {
      client,
      db: {} as Db,
      databaseUrl: "postgres://invalid-test-host/db",
      redisUrl: "redis://invalid-test-host",
      eventBus: {} as DomainEventBus,
      onShutdown: () => {},
    };

    await expect(Promise.resolve(tempVoiceFeatureModule.registerDiscordHandlers(ctx))).resolves.toBeUndefined();
    expect(on).toHaveBeenCalledWith("voiceStateUpdate", expect.any(Function));
  });
});
