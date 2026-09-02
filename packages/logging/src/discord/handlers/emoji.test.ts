import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import { registerEmojiHandlers, toEmojiCreateLogEntry, toEmojiDeleteLogEntry, toEmojiUpdateLogEntry } from "./emoji.js";

function fakeEmoji(id = "e1") {
  return { id, guild: { id: "g1" } } as never;
}

describe("emoji category mappers", () => {
  test("create", () => expect(toEmojiCreateLogEntry(fakeEmoji()).action).toBe("create"));
  test("update", () => expect(toEmojiUpdateLogEntry(fakeEmoji(), fakeEmoji()).action).toBe("update"));
  test("delete", () => expect(toEmojiDeleteLogEntry(fakeEmoji()).action).toBe("delete"));
});

describe("registerEmojiHandlers", () => {
  test("必要な3イベントをclient.onに登録する", () => {
    const on = mock(() => undefined);
    const ctx = { client: { on }, db: {} } as unknown as FeatureModuleContext;

    registerEmojiHandlers(ctx);

    expect(on.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining(["emojiCreate", "emojiUpdate", "emojiDelete"]),
    );
  });
});
