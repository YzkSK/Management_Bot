import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import { registerEmojiHandlers, toEmojiCreateLogEntry, toEmojiDeleteLogEntry, toEmojiUpdateLogEntry } from "./emoji.js";

function fakeEmoji(id = "e1") {
  return { id, guild: { id: "g1" } } as never;
}

describe("emoji category mappers", () => {
  test("create", () => {
    const entry = toEmojiCreateLogEntry(fakeEmoji());
    expect(entry.action).toBe("create");
    expect(entry.guildId).toBe("g1");
    expect(entry.emojiId).toBe("e1");
  });

  test("update: newEmoji側のidがLogEntryに設定される", () => {
    const entry = toEmojiUpdateLogEntry(fakeEmoji("old-e"), fakeEmoji("new-e"));
    expect(entry.action).toBe("update");
    expect(entry.guildId).toBe("g1");
    expect(entry.emojiId).toBe("new-e");
  });

  test("delete", () => {
    const entry = toEmojiDeleteLogEntry(fakeEmoji());
    expect(entry.action).toBe("delete");
    expect(entry.guildId).toBe("g1");
    expect(entry.emojiId).toBe("e1");
  });
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
