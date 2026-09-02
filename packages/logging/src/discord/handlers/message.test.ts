import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import {
  registerMessageHandlers,
  toMessageBulkDeleteLogEntries,
  toMessageCreateLogEntry,
  toMessageDeleteLogEntry,
  toMessageUpdateLogEntry,
} from "./message.js";

function fakeMessage(
  overrides: Partial<{ guildId: string | null; author: { id: string; bot: boolean } | null; channelId: string; content: string }> = {},
) {
  return {
    guildId: "g1",
    author: { id: "u1", bot: false },
    channelId: "c1",
    content: "hello",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as never;
}

describe("toMessageCreateLogEntry", () => {
  test("guild・authorが揃っていればcreateエントリを返す", () => {
    const entry = toMessageCreateLogEntry(fakeMessage());
    expect(entry).toEqual({
      category: "message",
      guildId: "g1",
      channelId: "c1",
      authorId: "u1",
      createdAt: "2026-01-01T00:00:00.000Z",
      action: "create",
      content: "hello",
    });
  });

  test("DMメッセージ(guildIdなし)はundefinedを返す", () => {
    expect(toMessageCreateLogEntry(fakeMessage({ guildId: null }))).toBeUndefined();
  });

  test("author未解決(partial)はundefinedを返す", () => {
    expect(toMessageCreateLogEntry(fakeMessage({ author: null }))).toBeUndefined();
  });

  test("Bot(自身を含む)の発言はundefinedを返す(ログ出力チャンネルへの送信が再度messageCreateを発火する無限連鎖を防ぐ)", () => {
    expect(toMessageCreateLogEntry(fakeMessage({ author: { id: "bot1", bot: true } }))).toBeUndefined();
  });
});

describe("toMessageUpdateLogEntry", () => {
  test("本文が変化していればupdateエントリを返す", () => {
    const entry = toMessageUpdateLogEntry(fakeMessage({ content: "old" }), fakeMessage({ content: "new" }));
    expect(entry?.action).toBe("update");
    expect(entry && "content" in entry ? entry.content : undefined).toBe("new");
  });

  test("本文が変化していなければundefinedを返す(ピン留め等のメタデータ更新)", () => {
    expect(toMessageUpdateLogEntry(fakeMessage({ content: "same" }), fakeMessage({ content: "same" }))).toBeUndefined();
  });
});

describe("toMessageDeleteLogEntry", () => {
  test("deleteエントリを返す", () => {
    expect(toMessageDeleteLogEntry(fakeMessage())?.action).toBe("delete");
  });
});

describe("toMessageBulkDeleteLogEntries", () => {
  test("メッセージごとに1件、bulkDeleteエントリを返す", () => {
    const messages = new Map([
      ["1", fakeMessage({ author: { id: "u1" } })],
      ["2", fakeMessage({ author: { id: "u2" } })],
    ]);
    const entries = toMessageBulkDeleteLogEntries(messages as never);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.action === "bulkDelete")).toBe(true);
  });
});

describe("registerMessageHandlers", () => {
  test("必要な4イベントをclient.onに登録する", () => {
    const on = mock(() => undefined);
    const ctx = { client: { on }, db: {} } as unknown as FeatureModuleContext;

    registerMessageHandlers(ctx);

    const events = on.mock.calls.map((call) => call[0]);
    expect(events).toEqual(
      expect.arrayContaining(["messageCreate", "messageUpdate", "messageDelete", "messageDeleteBulk"]),
    );
  });
});
