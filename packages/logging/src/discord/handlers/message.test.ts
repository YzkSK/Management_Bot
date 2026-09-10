import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import {
  registerMessageHandlers,
  toMessageBulkDeleteLogEntries,
  toMessageCreateLogEntry,
  toMessageDeleteLogEntry,
  toMessagePinLogEntry,
  toMessageUpdateLogEntry,
} from "./message.js";

const BOT_USER_ID = "bot1";

function fakeMessage(
  overrides: Partial<{
    id: string;
    guildId: string | null;
    author: { id: string; bot?: boolean; displayName?: string } | null;
    channelId: string;
    content: string;
    partial: boolean;
    pinned: boolean;
    system: boolean;
  }> = {},
) {
  return {
    id: "m1",
    guildId: "g1",
    author: { id: "u1", bot: false, displayName: "たろう" },
    channelId: "c1",
    content: "hello",
    partial: false,
    pinned: false,
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
      authorName: "たろう",
      createdAt: "2026-01-01T00:00:00.000Z",
      action: "create",
      content: "hello",
      actorIsBot: false,
    });
  });

  test("システムメッセージ(スレッド作成時のThreadCreated等)はundefinedを返す(threadCreateログと重複するため)", () => {
    expect(toMessageCreateLogEntry(fakeMessage({ system: true }), BOT_USER_ID)).toBeUndefined();
  });

  test("通常メッセージ(system:false)はcreateエントリを返す", () => {
    expect(toMessageCreateLogEntry(fakeMessage({ system: false }), BOT_USER_ID)?.action).toBe("create");
  });

  test("フォーラム投稿のスターターメッセージ(messageId===channelId)はundefinedを返す(threadCreateログと重複するため)", () => {
    expect(toMessageCreateLogEntry(fakeMessage({ id: "t1", channelId: "t1" }), BOT_USER_ID)).toBeUndefined();
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

  test("他Botの発言は除外しない(モデレーション上有用なため自Bot以外は記録する)が、actorIsBot=trueとして記録する", () => {
    const entry = toMessageCreateLogEntry(fakeMessage({ author: { id: "other-bot", bot: true } }), BOT_USER_ID);
    expect(entry?.action).toBe("create");
    expect(entry?.actorIsBot).toBe(true);
  });

  test("botUserId未確定(readyイベント前)ならfail-closedで何も記録しない(fail-openだと自Bot発言のフィルタが機能しなくなる)", () => {
    expect(toMessageCreateLogEntry(fakeMessage({ author: { id: "u1" } }), undefined)).toBeUndefined();
  });
});

describe("toMessageUpdateLogEntry", () => {
  test("本文が変化していればupdateエントリを返す(編集前本文も含む)", () => {
    const entry = toMessageUpdateLogEntry(fakeMessage({ content: "old" }), fakeMessage({ content: "new" }), BOT_USER_ID);
    expect(entry?.action).toBe("update");
    expect(entry && "content" in entry ? entry.content : undefined).toBe("new");
    expect(entry && "previousContent" in entry ? entry.previousContent : undefined).toBe("old");
  });

  test("編集前本文が空文字でもpreviousContentとして記録する", () => {
    const entry = toMessageUpdateLogEntry(fakeMessage({ content: "" }), fakeMessage({ content: "追記後" }), BOT_USER_ID);
    expect(entry?.action).toBe("update");
    expect(entry && "previousContent" in entry ? entry.previousContent : undefined).toBe("");
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

describe("toMessagePinLogEntry", () => {
  test("pinned: false→trueでpinエントリを返す(対象メッセージIDを含む)", () => {
    const entry = toMessagePinLogEntry(
      fakeMessage({ id: "m1", pinned: false }),
      fakeMessage({ id: "m1", pinned: true }),
      BOT_USER_ID,
    );
    expect(entry?.action).toBe("pin");
    expect(entry && "messageId" in entry ? entry.messageId : undefined).toBe("m1");
  });

  test("自Bot投稿のピン留めも記録する(pinログは投稿者ではなくピン状態の変更を記録するため除外しない)", () => {
    const entry = toMessagePinLogEntry(
      fakeMessage({ author: { id: BOT_USER_ID }, pinned: false }),
      fakeMessage({ author: { id: BOT_USER_ID }, pinned: true }),
      BOT_USER_ID,
    );
    expect(entry?.action).toBe("pin");
  });

  test("pinned: true→falseでunpinエントリを返す", () => {
    const entry = toMessagePinLogEntry(fakeMessage({ pinned: true }), fakeMessage({ pinned: false }), BOT_USER_ID);
    expect(entry?.action).toBe("unpin");
  });

  test("pinnedが変化していなければundefinedを返す", () => {
    expect(
      toMessagePinLogEntry(fakeMessage({ pinned: false }), fakeMessage({ pinned: false }), BOT_USER_ID),
    ).toBeUndefined();
  });

  test("oldMessageがpartialならundefinedを返す(変化を判定できないため)", () => {
    expect(
      toMessagePinLogEntry(
        fakeMessage({ pinned: false, partial: true }),
        fakeMessage({ pinned: true }),
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

  test("messageDeleteBulkは削除件数によらずDB保存を1回のマルチバリューINSERTにまとめる", async () => {
    const handlers = new Map<string, (...args: never[]) => unknown>();
    const on = mock((event: string, handler: (...args: never[]) => unknown) => {
      handlers.set(event, handler);
    });
    const insertCalls: unknown[] = [];
    const db = {
      insert: () => ({
        values: (values: unknown) => {
          insertCalls.push(values);
          return { onConflictDoNothing: () => Promise.resolve() };
        },
      }),
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    };
    const ctx = {
      client: { on, user: { id: BOT_USER_ID }, channels: { fetch: mock(() => Promise.resolve(null)) } },
      db,
    } as unknown as FeatureModuleContext;

    registerMessageHandlers(ctx);
    const messages = new Map([
      ["1", fakeMessage({ id: "1", author: { id: "u1" } })],
      ["2", fakeMessage({ id: "2", author: { id: "u2" } })],
      ["3", fakeMessage({ id: "3", author: { id: "u3" } })],
    ]) as unknown as Map<string, unknown> & { first: () => unknown };
    messages.first = () => [...messages.values()][0];

    await handlers.get("messageDeleteBulk")!(messages as never);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(insertCalls).toHaveLength(1);
    expect((insertCalls[0] as unknown[]).length).toBe(3);
  });
});
