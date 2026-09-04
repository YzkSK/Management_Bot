import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import { registerPollHandlers, toPollCreateLogEntry, toPollEndLogEntry } from "./poll.js";

function fakeMessage(
  overrides: Partial<{
    guildId: string | null;
    author: { id: string; bot: boolean } | null;
    poll: { resultsFinalized: boolean } | null;
  }> = {},
) {
  return {
    id: "m1",
    guildId: "g1",
    channelId: "c1",
    author: { id: "u1", bot: false },
    poll: { resultsFinalized: false },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as never;
}

describe("toPollCreateLogEntry", () => {
  test("pollを持つメッセージはcreateエントリを返す", () => {
    expect(toPollCreateLogEntry(fakeMessage())?.action).toBe("create");
  });

  test("pollがなければundefined", () => {
    expect(toPollCreateLogEntry(fakeMessage({ poll: null }))).toBeUndefined();
  });

  test("Botが作成したpollも除外せず記録する(loop対策が不要なため)", () => {
    expect(toPollCreateLogEntry(fakeMessage({ author: { id: "b1", bot: true } }))?.action).toBe("create");
  });
});

describe("toPollEndLogEntry", () => {
  test("resultsFinalizedがfalse→trueになればendエントリを返す", () => {
    const entry = toPollEndLogEntry(
      fakeMessage({ poll: { resultsFinalized: false } }),
      fakeMessage({ poll: { resultsFinalized: true } }),
    );
    expect(entry?.action).toBe("end");
  });

  test("既にresultsFinalizedがtrueだった場合はundefined(重複防止)", () => {
    const entry = toPollEndLogEntry(
      fakeMessage({ poll: { resultsFinalized: true } }),
      fakeMessage({ poll: { resultsFinalized: true } }),
    );
    expect(entry).toBeUndefined();
  });

  test("resultsFinalizedがfalseのままならundefined", () => {
    const entry = toPollEndLogEntry(
      fakeMessage({ poll: { resultsFinalized: false } }),
      fakeMessage({ poll: { resultsFinalized: false } }),
    );
    expect(entry).toBeUndefined();
  });

  test("旧pollが未キャッシュ(undefined)で前状態不明なら、newがfinalizedでも記録しない(誤検知防止)", () => {
    const entry = toPollEndLogEntry(fakeMessage({ poll: undefined }), fakeMessage({ poll: { resultsFinalized: true } }));
    expect(entry).toBeUndefined();
  });
});

describe("messageUpdateでのpoll end記録", () => {
  test("reconcilePendingPollと同じ`poll:end:${messageId}`をidに使い、起動時再照合と競合してもDBで1行にdedupされる", async () => {
    const inserts: { id: string }[] = [];
    const db = {
      insert: () => ({
        values: (values: { id: string }) => {
          inserts.push(values);
          return { onConflictDoNothing: () => ({ returning: () => Promise.resolve([{ id: values.id as string }]) }) };
        },
      }),
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    } as unknown as Db;
    const on = mock((_event: string, listener: (...args: unknown[]) => void) => {
      if (_event === "messageUpdate") {
        listener(fakeMessage({ poll: { resultsFinalized: false } }), fakeMessage({ poll: { resultsFinalized: true } }));
      }
    });
    const ctx = { client: { on, once: mock(() => undefined) }, db } as unknown as FeatureModuleContext;

    registerPollHandlers(ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(inserts).toHaveLength(1);
    expect(inserts[0].id).toBe("poll:end:m1");
  });

  test("起動時再照合とmessageUpdateが同じpollのendで競合しても、Discordへの通知は1回だけ行う", async () => {
    const sendToChannel = mock(() => Promise.resolve());
    // 2回目以降のinsertは同一idのため、実DBのonConflictDoNothingを模して空配列(0件更新)を返す。
    const insertedIds = new Set<string>();
    const db = {
      execute: () => Promise.resolve([{ guild_id: "g1", channel_id: "c1", message_id: "m1" }]),
      insert: () => ({
        values: (values: { id: string }) => ({
          onConflictDoNothing: () => ({
            returning: () => {
              const isNew = !insertedIds.has(values.id);
              insertedIds.add(values.id);
              return Promise.resolve(isNew ? [{ id: values.id }] : []);
            },
          }),
        }),
      }),
      select: () => ({ from: () => ({ where: () => Promise.resolve([{ channelId: "log-channel" }]) }) }),
    } as unknown as Db;
    const sendableChannel = { isTextBased: () => true, isSendable: () => true, send: sendToChannel };
    const pollMessageChannel = {
      isTextBased: () => true,
      messages: { fetch: () => Promise.resolve(fakeMessage({ poll: { resultsFinalized: true } })) },
    };
    const channels = {
      fetch: (channelId: string) => Promise.resolve(channelId === "log-channel" ? sendableChannel : pollMessageChannel),
    };
    let messageUpdateListener: ((...args: unknown[]) => void) | undefined;
    const on = mock((event: string, listener: (...args: unknown[]) => void) => {
      if (event === "messageUpdate") messageUpdateListener = listener;
    });
    let readyListener: (() => void) | undefined;
    const once = mock((_event: string, listener: () => void) => {
      readyListener = listener;
    });
    const ctx = {
      client: { on, once, channels },
      db,
    } as unknown as FeatureModuleContext;

    registerPollHandlers(ctx);
    await Promise.all([
      readyListener?.(),
      Promise.resolve().then(() =>
        messageUpdateListener?.(fakeMessage({ poll: { resultsFinalized: false } }), fakeMessage({ poll: { resultsFinalized: true } })),
      ),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendToChannel).toHaveBeenCalledTimes(1);
  });
});

describe("registerPollHandlers", () => {
  test("messageCreate/messageUpdateをclient.onに登録し、readyでの再照合をclient.onceに登録する", () => {
    const on = mock(() => undefined);
    const once = mock(() => undefined);
    const ctx = { client: { on, once }, db: {} } as unknown as FeatureModuleContext;

    registerPollHandlers(ctx);

    expect(on.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining(["messageCreate", "messageUpdate"]));
    expect(once.mock.calls.map((call) => call[0])).toEqual(["ready"]);
  });
});

describe("poll終了の再照合(起動時)", () => {
  function fakeDb(pendingRows: { guild_id: string; channel_id: string; message_id: string }[], inserts: unknown[]): Db {
    return {
      execute: () => Promise.resolve(pendingRows),
      insert: () => ({
        values: (values: { id: string }) => {
          inserts.push(values);
          return { onConflictDoNothing: () => ({ returning: () => Promise.resolve([{ id: values.id }]) }) };
        },
      }),
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    } as unknown as Db;
  }

  function fakeCtx(db: Db, message: unknown): FeatureModuleContext {
    const once = mock((_event: string, listener: () => void) => {
      readyListener = listener;
    });
    const channels = { fetch: () => Promise.resolve({ isTextBased: () => true, messages: { fetch: () => Promise.resolve(message) } }) };
    return { client: { on: mock(() => undefined), once, channels }, db } as unknown as FeatureModuleContext;
  }

  let readyListener: (() => void) | undefined;

  test("resultsFinalizedがtrueのpendingなpollはendを記録する", async () => {
    const inserts: unknown[] = [];
    const db = fakeDb([{ guild_id: "g1", channel_id: "c1", message_id: "m1" }], inserts);
    const ctx = fakeCtx(db, { poll: { resultsFinalized: true } });

    registerPollHandlers(ctx);
    await readyListener?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ category: "poll", payload: { action: "end" } });
  });

  test("resultsFinalizedがまだfalseなら何もしない", async () => {
    const inserts: unknown[] = [];
    const db = fakeDb([{ guild_id: "g1", channel_id: "c1", message_id: "m1" }], inserts);
    const ctx = fakeCtx(db, { poll: { resultsFinalized: false } });

    registerPollHandlers(ctx);
    await readyListener?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(inserts).toHaveLength(0);
  });

  test("メッセージが取得できない(削除済み等)場合は何もしない", async () => {
    const inserts: unknown[] = [];
    const db = fakeDb([{ guild_id: "g1", channel_id: "c1", message_id: "m1" }], inserts);
    const once = mock((_event: string, listener: () => void) => {
      readyListener = listener;
    });
    const channels = { fetch: () => Promise.reject(new Error("Unknown Message")) };
    const ctx = { client: { on: mock(() => undefined), once, channels }, db } as unknown as FeatureModuleContext;

    registerPollHandlers(ctx);
    await readyListener?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(inserts).toHaveLength(0);
  });
});
