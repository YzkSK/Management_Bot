import { describe, expect, mock, spyOn, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import {
  fetchThreadStarterContent,
  registerThreadHandlers,
  toThreadCreateLogEntry,
  toThreadDeleteLogEntry,
  toThreadMembershipLogEntries,
  toThreadUpdateLogEntry,
} from "./thread.js";

function fakeThread(
  overrides: Partial<{ id: string; guildId: string; parentId: string | null; archived: boolean | null; name: string }> = {},
) {
  return { id: "t1", guildId: "g1", parentId: "c1", archived: false, name: "質問スレ", ...overrides } as never;
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

  test("create: contentを渡すとエントリに含まれる(フォーラム投稿のスターターメッセージ本文)", () => {
    expect(toThreadCreateLogEntry(fakeThread(), "質問内容です")?.content).toBe("質問内容です");
  });

  test("create: contentを渡さなければundefined(通常スレッド)", () => {
    expect(toThreadCreateLogEntry(fakeThread())?.content).toBeUndefined();
  });

  test("create: threadNameにイベント発生時点のスレッド名を記録する(アーカイブ後もAPIに依存せず表示するため)", () => {
    expect(toThreadCreateLogEntry(fakeThread({ name: "雑談" }))?.threadName).toBe("雑談");
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

describe("fetchThreadStarterContent", () => {
  test("フォーラム投稿(isThreadOnlyな親)はスターターメッセージ本文を返す", async () => {
    const fetchStarterMessage = mock(async () => ({ content: "投稿本文です" }));
    const thread = { ...fakeThread(), fetchStarterMessage, parent: { isThreadOnly: () => true } } as never;

    expect(await fetchThreadStarterContent(thread)).toBe("投稿本文です");
    expect(fetchStarterMessage).toHaveBeenCalledTimes(1);
  });

  test("通常スレッド(isThreadOnlyでない親)はスターターメッセージを取得せずundefined", async () => {
    const fetchStarterMessage = mock(async () => ({ content: "元メッセージ" }));
    const thread = { ...fakeThread(), fetchStarterMessage, parent: { isThreadOnly: () => false } } as never;

    expect(await fetchThreadStarterContent(thread)).toBeUndefined();
    expect(fetchStarterMessage).not.toHaveBeenCalled();
  });

  test("親が未解決(parent: null)ならundefined", async () => {
    const thread = { ...fakeThread(), parent: null } as never;

    expect(await fetchThreadStarterContent(thread)).toBeUndefined();
  });

  test("フォーラム投稿でも取得失敗(削除済み等)はundefined(ベストエフォート)、失敗はログに残す", async () => {
    const error = new Error("not found");
    const fetchStarterMessage = mock(async () => {
      throw error;
    });
    const thread = { ...fakeThread({ id: "t1" }), fetchStarterMessage, parent: { isThreadOnly: () => true } } as never;
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(await fetchThreadStarterContent(thread)).toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith("Failed to fetch starter message for thread t1", error);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
