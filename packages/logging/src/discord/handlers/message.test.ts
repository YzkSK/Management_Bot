import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import {
  registerMessageHandlers,
  toMessageBulkDeleteLogEntries,
  toMessageCreateLogEntry,
  toMessageDeleteLogEntry,
  toMessageUpdateLogEntry,
} from "./message.js";

const BOT_USER_ID = "bot1";

function fakeMessage(
  overrides: Partial<{
    guildId: string | null;
    author: { id: string } | null;
    channelId: string;
    content: string;
    partial: boolean;
  }> = {},
) {
  return {
    guildId: "g1",
    author: { id: "u1" },
    channelId: "c1",
    content: "hello",
    partial: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as never;
}

describe("toMessageCreateLogEntry", () => {
  test("guild・authorが揃っていればcreateエントリを返す", () => {
    const entry = toMessageCreateLogEntry(fakeMessage(), BOT_USER_ID);
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
    expect(toMessageCreateLogEntry(fakeMessage({ guildId: null }), BOT_USER_ID)).toBeUndefined();
  });

  test("author未解決(partial)はundefinedを返す", () => {
    expect(toMessageCreateLogEntry(fakeMessage({ author: null }), BOT_USER_ID)).toBeUndefined();
  });

  test("自Bot自身の発言はundefinedを返す(ログ出力チャンネルへの送信が再度messageCreateを発火する無限連鎖を防ぐ)", () => {
    expect(toMessageCreateLogEntry(fakeMessage({ author: { id: BOT_USER_ID } }), BOT_USER_ID)).toBeUndefined();
  });

  test("他Botの発言は除外しない(モデレーション上有用なため自Bot以外は記録する)", () => {
    const entry = toMessageCreateLogEntry(fakeMessage({ author: { id: "other-bot" } }), BOT_USER_ID);
    expect(entry?.action).toBe("create");
  });

  test("botUserId未確定(readyイベント前)ならfail-closedで何も記録しない(fail-openだと自Bot発言のフィルタが機能しなくなる)", () => {
    expect(toMessageCreateLogEntry(fakeMessage({ author: { id: "u1" } }), undefined)).toBeUndefined();
  });
});

describe("toMessageUpdateLogEntry", () => {
  test("本文が変化していればupdateエントリを返す", () => {
    const entry = toMessageUpdateLogEntry(fakeMessage({ content: "old" }), fakeMessage({ content: "new" }), BOT_USER_ID);
    expect(entry?.action).toBe("update");
    expect(entry && "content" in entry ? entry.content : undefined).toBe("new");
  });

  test("本文が変化していなければundefinedを返す(ピン留め等のメタデータ更新)", () => {
    expect(
      toMessageUpdateLogEntry(fakeMessage({ content: "same" }), fakeMessage({ content: "same" }), BOT_USER_ID),
    ).toBeUndefined();
  });

  test("oldMessageがpartialならcontent比較をせずundefinedを返す(誤ったupdateログ防止)", () => {
    expect(
      toMessageUpdateLogEntry(
        fakeMessage({ content: "old", partial: true }),
        fakeMessage({ content: "new" }),
        BOT_USER_ID,
      ),
    ).toBeUndefined();
  });
});

describe("toMessageDeleteLogEntry", () => {
  test("deleteエントリを返す", () => {
    expect(toMessageDeleteLogEntry(fakeMessage(), BOT_USER_ID)?.action).toBe("delete");
  });
});

describe("toMessageBulkDeleteLogEntries", () => {
  test("メッセージごとに1件、bulkDeleteエントリを返す(自Botのメッセージは除外)", () => {
    const messages = new Map([
      ["1", fakeMessage({ author: { id: "u1" } })],
      ["2", fakeMessage({ author: { id: "u2" } })],
      ["3", fakeMessage({ author: { id: BOT_USER_ID } })],
    ]);
    const entries = toMessageBulkDeleteLogEntries(messages as never, BOT_USER_ID);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.action === "bulkDelete")).toBe(true);
  });
});

describe("registerMessageHandlers", () => {
  test("必要な4イベントをclient.onに登録する", () => {
    const on = mock(() => undefined);
    const ctx = { client: { on, user: { id: BOT_USER_ID } }, db: {} } as unknown as FeatureModuleContext;

    registerMessageHandlers(ctx);

    const events = on.mock.calls.map((call) => call[0]);
    expect(events).toEqual(
      expect.arrayContaining(["messageCreate", "messageUpdate", "messageDelete", "messageDeleteBulk"]),
    );
  });
});
