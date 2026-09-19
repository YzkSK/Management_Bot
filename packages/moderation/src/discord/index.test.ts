import { describe, expect, mock, test } from "bun:test";
import type { DomainEventBus, FeatureModuleContext } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import { createInviteGuildIdResolver, registerDiscordHandlers } from "./index.js";

describe("registerDiscordHandlers", () => {
  test("messageCreate/messageUpdate/guildMemberAddの3つのハンドラを登録する(#362-7.1)", () => {
    const on = mock(() => undefined);
    const once = mock(() => undefined);
    const onShutdown = mock(() => undefined);
    const ctx = {
      client: { on, once, isReady: () => false },
      db: {} as Db,
      databaseUrl: "postgres://invalid-test-host/db",
      redisUrl: "redis://invalid-test-host:6379",
      eventBus: {} as DomainEventBus,
      onShutdown,
    } as unknown as FeatureModuleContext;

    registerDiscordHandlers(ctx);

    expect(on).toHaveBeenCalledTimes(3);
    expect(on.mock.calls.map((call) => call[0])).toEqual(["messageCreate", "messageUpdate", "guildMemberAdd"]);
    expect(once).toHaveBeenCalledWith("ready", expect.any(Function));
    // redis(メッセージ処理用)とmoderation_config_changedのLISTEN接続(#353)の2つを解放する。
    expect(onShutdown).toHaveBeenCalledTimes(2);
  });
});

describe("createInviteGuildIdResolver", () => {
  test("同一コードの再解決はTTL内ならfetchInviteを再実行しない(#362)", async () => {
    const fetchInvite = mock(() => Promise.resolve({ guild: { id: "guild-1" } }));
    const client = { fetchInvite } as unknown as FeatureModuleContext["client"];
    const resolve = createInviteGuildIdResolver(client);

    expect(await resolve("code-a")).toBe("guild-1");
    expect(await resolve("code-a")).toBe("guild-1");

    expect(fetchInvite).toHaveBeenCalledTimes(1);
  });

  test("解決失敗はキャッシュせず次回呼び出しで再試行する", async () => {
    const fetchInvite = mock(() => Promise.reject(new Error("invalid invite")));
    const client = { fetchInvite } as unknown as FeatureModuleContext["client"];
    const resolve = createInviteGuildIdResolver(client);

    expect(await resolve("code-b")).toBeNull();
    expect(await resolve("code-b")).toBeNull();

    expect(fetchInvite).toHaveBeenCalledTimes(2);
  });

  test("guild.idが取得できない解決結果もキャッシュせず次回呼び出しで再試行する(Codexレビュー指摘)", async () => {
    const fetchInvite = mock(() => Promise.resolve({ guild: undefined }));
    const client = { fetchInvite } as unknown as FeatureModuleContext["client"];
    const resolve = createInviteGuildIdResolver(client);

    expect(await resolve("code-c")).toBeNull();
    expect(await resolve("code-c")).toBeNull();

    expect(fetchInvite).toHaveBeenCalledTimes(2);
  });
});
