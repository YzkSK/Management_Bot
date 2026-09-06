import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import {
  registerThreadHandlers,
  toThreadCreateLogEntry,
  toThreadDeleteLogEntry,
  toThreadMembershipLogEntries,
  toThreadUpdateLogEntry,
} from "./thread.js";

function fakeThread(overrides: Partial<{ id: string; guildId: string; parentId: string | null; archived: boolean | null }> = {}) {
  return { id: "t1", guildId: "g1", parentId: "c1", archived: false, ...overrides } as never;
}

function fakeCollection(ids: string[]) {
  return new Map(ids.map((id) => [id, { id }])) as never;
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

  test("update: archivedがnull(状態不明)を含む場合はupdate扱いにする(archive/unarchiveと誤判定しない)", () => {
    expect(toThreadUpdateLogEntry(fakeThread({ archived: null }), fakeThread({ archived: false }))?.action).toBe("update");
    expect(toThreadUpdateLogEntry(fakeThread({ archived: false }), fakeThread({ archived: null }))?.action).toBe("update");
    expect(toThreadUpdateLogEntry(fakeThread({ archived: null }), fakeThread({ archived: true }))?.action).toBe("update");
  });
});

describe("toThreadMembershipLogEntries", () => {
  test("addedMembersはmemberAdd、removedMembersはmemberRemoveになり、対象メンバーのuserIdを含む", () => {
    const entries = toThreadMembershipLogEntries(fakeCollection(["u1"]), fakeCollection(["u2"]), fakeThread());
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: "u1", action: "memberAdd", threadId: "t1" }),
        expect.objectContaining({ userId: "u2", action: "memberRemove", threadId: "t1" }),
      ]),
    );
    expect(entries).toHaveLength(2);
  });

  test("親チャンネル不明なら空配列", () => {
    expect(toThreadMembershipLogEntries(fakeCollection(["u1"]), fakeCollection([]), fakeThread({ parentId: null }))).toEqual([]);
  });
});

describe("registerThreadHandlers", () => {
  test("必要な4イベントをclient.onに登録する", () => {
    const on = mock(() => undefined);
    const ctx = { client: { on }, db: {} } as unknown as FeatureModuleContext;

    registerThreadHandlers(ctx);

    expect(on.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining(["threadCreate", "threadDelete", "threadUpdate", "threadMembersUpdate"]),
    );
  });
});
