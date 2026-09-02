import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import { registerThreadHandlers, toThreadCreateLogEntry, toThreadDeleteLogEntry, toThreadUpdateLogEntry } from "./thread.js";

function fakeThread(overrides: Partial<{ id: string; guildId: string; parentId: string | null; archived: boolean | null }> = {}) {
  return { id: "t1", guildId: "g1", parentId: "c1", archived: false, ...overrides } as never;
}

describe("thread category mappers", () => {
  test("create: 親チャンネルがあればcreateエントリを返す", () => {
    expect(toThreadCreateLogEntry(fakeThread())?.action).toBe("create");
  });

  test("create: 親チャンネル不明ならundefined", () => {
    expect(toThreadCreateLogEntry(fakeThread({ parentId: null }))).toBeUndefined();
  });

  test("delete", () => {
    expect(toThreadDeleteLogEntry(fakeThread())?.action).toBe("delete");
  });

  test("update: archived差分がfalse→trueならarchive", () => {
    const entry = toThreadUpdateLogEntry(fakeThread({ archived: false }), fakeThread({ archived: true }));
    expect(entry?.action).toBe("archive");
  });

  test("update: archived差分がtrue→falseならunarchive", () => {
    const entry = toThreadUpdateLogEntry(fakeThread({ archived: true }), fakeThread({ archived: false }));
    expect(entry?.action).toBe("unarchive");
  });

  test("update: archivedが変化していなければupdate", () => {
    const entry = toThreadUpdateLogEntry(fakeThread({ archived: false }), fakeThread({ archived: false }));
    expect(entry?.action).toBe("update");
  });
});

describe("registerThreadHandlers", () => {
  test("必要な3イベントをclient.onに登録する", () => {
    const on = mock(() => undefined);
    const ctx = { client: { on }, db: {} } as unknown as FeatureModuleContext;

    registerThreadHandlers(ctx);

    expect(on.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining(["threadCreate", "threadDelete", "threadUpdate"]),
    );
  });
});
