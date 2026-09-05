import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import { registerReactionHandlers, toReactionAddLogEntry, toReactionRemoveLogEntry } from "./reaction.js";

function fakeReaction(emojiIdentifier = "%F0%9F%98%80") {
  return {
    message: { guildId: "g1", channelId: "c1", id: "m1" },
    emoji: { identifier: emojiIdentifier },
  } as never;
}

function fakeUser(id = "u1", partial = false) {
  return { id, partial } as never;
}

describe("reaction category mappers", () => {
  test("add", () => {
    const entry = toReactionAddLogEntry(fakeReaction(), fakeUser());
    expect(entry?.action).toBe("add");
    expect(entry?.guildId).toBe("g1");
    expect((entry as { channelId: string }).channelId).toBe("c1");
    expect((entry as { messageId: string }).messageId).toBe("m1");
    expect((entry as { userId: string }).userId).toBe("u1");
    expect((entry as { emoji: string }).emoji).toBe("%F0%9F%98%80");
  });

  test("remove", () => {
    const entry = toReactionRemoveLogEntry(fakeReaction(), fakeUser());
    expect(entry?.action).toBe("remove");
  });

  test("messageがpartialでguildId未取得の場合はundefined", () => {
    const reaction = { message: { guildId: null, channelId: "c1", id: "m1" }, emoji: { identifier: "x" } } as never;
    expect(toReactionAddLogEntry(reaction, fakeUser())).toBeUndefined();
  });

  test("userがpartial(未キャッシュ)の場合はundefined", () => {
    expect(toReactionAddLogEntry(fakeReaction(), fakeUser("u1", true))).toBeUndefined();
  });
});

describe("registerReactionHandlers", () => {
  test("必要な2イベントをclient.onに登録する", () => {
    const on = mock(() => undefined);
    const ctx = { client: { on }, db: {} } as unknown as FeatureModuleContext;

    registerReactionHandlers(ctx);

    expect(on.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining(["messageReactionAdd", "messageReactionRemove"]),
    );
  });
});
