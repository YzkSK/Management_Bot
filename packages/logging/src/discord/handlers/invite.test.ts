import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import { registerInviteHandlers, toInviteCreateLogEntry, toInviteDeleteLogEntry } from "./invite.js";

function fakeInvite(overrides: Partial<{ guild: { id: string } | null; channelId: string | null; code: string }> = {}) {
  return { guild: { id: "g1" }, channelId: "c1", code: "abc123", ...overrides } as never;
}

describe("invite category mappers", () => {
  test("create: guild・channelIdが揃っていればcreateエントリを返す", () => {
    expect(toInviteCreateLogEntry(fakeInvite())?.action).toBe("create");
  });

  test("create: guild不明ならundefined", () => {
    expect(toInviteCreateLogEntry(fakeInvite({ guild: null }))).toBeUndefined();
  });

  test("delete", () => {
    expect(toInviteDeleteLogEntry(fakeInvite())?.action).toBe("delete");
  });
});

describe("registerInviteHandlers", () => {
  test("必要な2イベントをclient.onに登録する", () => {
    const on = mock(() => undefined);
    const ctx = { client: { on }, db: {} } as unknown as FeatureModuleContext;

    registerInviteHandlers(ctx);

    expect(on.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining(["inviteCreate", "inviteDelete"]));
  });
});
