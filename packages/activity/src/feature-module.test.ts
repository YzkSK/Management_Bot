import { describe, expect, mock, test } from "bun:test";
import { BotClient, type DomainEventBus, type FeatureModuleContext } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import { activityFeatureModule } from "./feature-module.js";

describe("activityFeatureModule", () => {
  test("keyがactivityである", () => {
    expect(activityFeatureModule.key).toBe("activity");
  });

  test("registerDiscordHandlersはvoiceStateUpdate/messageCreateを登録し、停止処理を登録する", async () => {
    const client = new BotClient();
    const on = mock(() => client);
    (client as unknown as { on: typeof on }).on = on;
    const shutdowns: (() => Promise<void>)[] = [];
    const ctx: FeatureModuleContext = {
      client,
      db: {} as Db,
      databaseUrl: "postgres://invalid-test-host/db",
      redisUrl: "redis://invalid-test-host",
      eventBus: {} as DomainEventBus,
      env: {},
      onShutdown: (cleanup) => {
        shutdowns.push(cleanup);
      },
    };

    await expect(Promise.resolve(activityFeatureModule.registerDiscordHandlers(ctx))).resolves.toBeUndefined();
    expect(on).toHaveBeenCalledWith("voiceStateUpdate", expect.any(Function));
    expect(on).toHaveBeenCalledWith("messageCreate", expect.any(Function));
    expect(shutdowns).toHaveLength(1);
    // 記録が無い状態の停止処理はDBに触れずに完了する(flushタイマーも止まる)。
    await shutdowns[0]?.();
  });
});
