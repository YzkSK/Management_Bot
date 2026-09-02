import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import { registerGuildHandlers, toGuildUpdateLogEntry } from "./guild.js";

describe("toGuildUpdateLogEntry", () => {
  test("actionは常にupdate", () => {
    const entry = toGuildUpdateLogEntry({ id: "g1" } as never);
    expect(entry).toEqual({ category: "guild", guildId: "g1", createdAt: entry.createdAt, action: "update" });
  });
});

describe("registerGuildHandlers", () => {
  test("guildUpdateをclient.onに登録する", () => {
    const on = mock(() => undefined);
    const ctx = { client: { on }, db: {} } as unknown as FeatureModuleContext;

    registerGuildHandlers(ctx);

    expect(on.mock.calls.map((call) => call[0])).toEqual(["guildUpdate"]);
  });
});
