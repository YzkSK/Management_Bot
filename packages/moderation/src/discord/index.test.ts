import { describe, expect, mock, test } from "bun:test";
import type { DomainEventBus, FeatureModuleContext } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import { registerDiscordHandlers } from "./index.js";

describe("registerDiscordHandlers", () => {
  test("messageCreateハンドラを登録する", () => {
    const on = mock(() => undefined);
    const onShutdown = mock(() => undefined);
    const ctx = {
      client: { on },
      db: {} as Db,
      databaseUrl: "postgres://invalid-test-host/db",
      redisUrl: "redis://invalid-test-host:6379",
      eventBus: {} as DomainEventBus,
      onShutdown,
    } as unknown as FeatureModuleContext;

    registerDiscordHandlers(ctx);

    expect(on).toHaveBeenCalledTimes(1);
    expect(on.mock.calls[0]?.[0]).toBe("messageCreate");
    expect(onShutdown).toHaveBeenCalledTimes(1);
  });
});
