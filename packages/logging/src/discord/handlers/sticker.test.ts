import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import { registerStickerHandlers, toStickerCreateLogEntry, toStickerDeleteLogEntry, toStickerUpdateLogEntry } from "./sticker.js";

function fakeSticker(id = "s1", guildId: string | null = "g1") {
  return { id, guildId } as never;
}

describe("sticker category mappers", () => {
  test("create", () => {
    const entry = toStickerCreateLogEntry(fakeSticker());
    expect(entry?.action).toBe("create");
    expect(entry?.guildId).toBe("g1");
    expect((entry as { stickerId: string }).stickerId).toBe("s1");
  });

  test("update: newSticker側のidがLogEntryに設定される", () => {
    const entry = toStickerUpdateLogEntry(fakeSticker("old-s"), fakeSticker("new-s"));
    expect(entry?.action).toBe("update");
    expect(entry?.guildId).toBe("g1");
    expect((entry as { stickerId: string }).stickerId).toBe("new-s");
  });

  test("delete", () => {
    const entry = toStickerDeleteLogEntry(fakeSticker());
    expect(entry?.action).toBe("delete");
    expect(entry?.guildId).toBe("g1");
    expect((entry as { stickerId: string }).stickerId).toBe("s1");
  });

  test("guildIdがnull(DMスタンプ等)の場合はundefinedを返す", () => {
    expect(toStickerCreateLogEntry(fakeSticker("s1", null))).toBeUndefined();
    expect(toStickerUpdateLogEntry(fakeSticker("s1", null), fakeSticker("s1", null))).toBeUndefined();
    expect(toStickerDeleteLogEntry(fakeSticker("s1", null))).toBeUndefined();
  });
});

describe("registerStickerHandlers", () => {
  test("必要な3イベントをclient.onに登録する", () => {
    const on = mock(() => undefined);
    const ctx = { client: { on }, db: {} } as unknown as FeatureModuleContext;

    registerStickerHandlers(ctx);

    expect(on.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining(["stickerCreate", "stickerUpdate", "stickerDelete"]),
    );
  });
});
