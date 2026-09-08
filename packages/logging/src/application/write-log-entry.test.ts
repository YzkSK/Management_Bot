import { describe, expect, mock, test } from "bun:test";
import type { Db } from "@management-bot/db";
import { logChannelSettings, logEntries } from "@management-bot/db";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { LogEntry } from "../domain/index.js";
import { createChannelSettingResolver, formatLogEntry, writeLogEntry } from "./write-log-entry.js";

const pgDialect = new PgDialect();

interface RecordedInsert {
  table: unknown;
  values: unknown;
}

function fakeDb(
  inserts: RecordedInsert[],
  channelSetting: { channelId: string } | undefined,
  captureWhere?: (condition: SQL | undefined) => void,
  /** falseにすると、insertが既存行との競合で0件になったこと(onConflictDoNothingが実際に発動)をシミュレートする。 */
  insertSucceeds = true,
): Db {
  return {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        return {
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve(insertSucceeds ? [{ id: (values as { id: string }).id }] : []),
          }),
        };
      },
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: SQL | undefined) => {
          captureWhere?.(condition);
          return Promise.resolve(table === logChannelSettings && channelSetting ? [channelSetting] : []);
        },
      }),
    }),
  } as unknown as Db;
}

const memberJoinEntry: LogEntry = {
  category: "member",
  guildId: "g1",
  createdAt: "2026-08-31T00:00:00.000Z",
  userId: "u1",
  action: "join",
};

describe("writeLogEntry", () => {
  test("log_entriesへ保存する", async () => {
    const inserts: RecordedInsert[] = [];
    const db = fakeDb(inserts, undefined);
    const sendToChannel = mock(() => Promise.resolve());

    await writeLogEntry({ db, sendToChannel }, memberJoinEntry);

    expect(inserts[0]?.table).toBe(logEntries);
    expect(inserts[0]?.values).toMatchObject({
      guildId: "g1",
      category: "member",
      payload: memberJoinEntry,
    });
  });

  test("出力先チャンネル未設定ならsendToChannelを呼ばない", async () => {
    const db = fakeDb([], undefined);
    const sendToChannel = mock(() => Promise.resolve());

    await writeLogEntry({ db, sendToChannel }, memberJoinEntry);

    expect(sendToChannel).not.toHaveBeenCalled();
  });

  test("出力先チャンネル設定があれば整形して送信し、メンションを抑制する", async () => {
    const db = fakeDb([], { channelId: "c1" });
    const sendToChannel = mock(() => Promise.resolve());

    await writeLogEntry({ db, sendToChannel }, memberJoinEntry);

    expect(sendToChannel).toHaveBeenCalledWith("c1", {
      content: formatLogEntry(memberJoinEntry),
      suppressMentions: true,
    });
  });

  test("select条件はguildIdとcategoryのANDで絞り込む", async () => {
    let captured: SQL | undefined;
    const db = fakeDb([], undefined, (condition) => {
      captured = condition;
    });

    await writeLogEntry({ db, sendToChannel: mock(() => Promise.resolve()) }, memberJoinEntry);

    const { sql, params } = pgDialect.sqlToQuery(captured!);
    expect(sql).toContain('"guild_id" = $1');
    expect(sql).toContain('"category" = $2');
    expect(params).toEqual(["g1", "member"]);
  });

  test("同一idで再実行してもチャンネル送信は(insertの成否によらず)毎回試みる", async () => {
    const inserts: RecordedInsert[] = [];
    const db = fakeDb(inserts, { channelId: "c1" });
    const sendToChannel = mock(() => Promise.resolve());

    await writeLogEntry({ db, sendToChannel }, memberJoinEntry, "fixed-entry-id");
    await writeLogEntry({ db, sendToChannel }, memberJoinEntry, "fixed-entry-id");

    expect(inserts).toHaveLength(2);
    expect(sendToChannel).toHaveBeenCalledTimes(2);
  });

  test("idを指定するとその値でinsertする", async () => {
    const inserts: RecordedInsert[] = [];
    const db = fakeDb(inserts, undefined);

    await writeLogEntry({ db, sendToChannel: mock(() => Promise.resolve()) }, memberJoinEntry, "fixed-entry-id");

    expect(inserts[0]?.values).toMatchObject({ id: "fixed-entry-id" });
  });

  test("skipNotifyIfExists=trueで、既に同一idの行が存在する(insertが競合で0件)場合は送信しない", async () => {
    const db = fakeDb([], { channelId: "c1" }, undefined, false);
    const sendToChannel = mock(() => Promise.resolve());

    await writeLogEntry({ db, sendToChannel }, memberJoinEntry, "fixed-entry-id", true);

    expect(sendToChannel).not.toHaveBeenCalled();
  });

  test("skipNotifyIfExists=trueでも、insertが新規行として成功していれば送信する", async () => {
    const db = fakeDb([], { channelId: "c1" }, undefined, true);
    const sendToChannel = mock(() => Promise.resolve());

    await writeLogEntry({ db, sendToChannel }, memberJoinEntry, "fixed-entry-id", true);

    expect(sendToChannel).toHaveBeenCalledTimes(1);
  });

  test("初回送信が失敗しても同一idで再実行すれば送信される(DB保存済みでも永久欠落しない)", async () => {
    const db = fakeDb([], { channelId: "c1" });
    const sendToChannel = mock(() => Promise.reject(new Error("discord api error")));

    await expect(writeLogEntry({ db, sendToChannel }, memberJoinEntry, "fixed-entry-id")).rejects.toThrow(
      "discord api error",
    );

    sendToChannel.mockImplementation(() => Promise.resolve());
    await writeLogEntry({ db, sendToChannel }, memberJoinEntry, "fixed-entry-id");

    expect(sendToChannel).toHaveBeenCalledTimes(2);
  });

  test("getChannelIdを注入すると、出力先チャンネル解決にdbへの直接SELECTではなくそちらを使う", async () => {
    const db = fakeDb([], undefined); // このdbへのselectが呼ばれれば{channelId: undefined}扱いになりバグに気づける
    const sendToChannel = mock(() => Promise.resolve());
    const getChannelId = mock(() => Promise.resolve("c1"));

    await writeLogEntry({ db, sendToChannel, getChannelId }, memberJoinEntry);

    expect(getChannelId).toHaveBeenCalledWith("g1", "member");
    expect(sendToChannel).toHaveBeenCalledWith("c1", {
      content: formatLogEntry(memberJoinEntry),
      suppressMentions: true,
    });
  });

  test("getChannelIdがnullを返すとsendToChannelを呼ばない", async () => {
    const db = fakeDb([], { channelId: "c1" }); // dbには設定があるが、注入したgetChannelIdが優先される
    const sendToChannel = mock(() => Promise.resolve());
    const getChannelId = mock(() => Promise.resolve(null));

    await writeLogEntry({ db, sendToChannel, getChannelId }, memberJoinEntry);

    expect(sendToChannel).not.toHaveBeenCalled();
  });
});

describe("createChannelSettingResolver", () => {
  test("同じguildId×categoryへの並行呼び出しはSELECTを1回しか実行しない", async () => {
    let selectCalls = 0;
    const db = fakeDb([], { channelId: "c1" }, () => {
      selectCalls++;
    });
    const resolver = createChannelSettingResolver(db, 10_000);

    const [a, b] = await Promise.all([resolver("g1", "member"), resolver("g1", "member")]);

    expect(a).toBe("c1");
    expect(b).toBe("c1");
    expect(selectCalls).toBe(1);
  });

  test("guildIdまたはcategoryが異なれば個別にSELECTする", async () => {
    let selectCalls = 0;
    const db = fakeDb([], { channelId: "c1" }, () => {
      selectCalls++;
    });
    const resolver = createChannelSettingResolver(db, 10_000);

    await Promise.all([resolver("g1", "member"), resolver("g2", "member"), resolver("g1", "message")]);

    expect(selectCalls).toBe(3);
  });

  test("出力先未設定(null)の結果もTTL内はキャッシュする", async () => {
    let selectCalls = 0;
    const db = fakeDb([], undefined, () => {
      selectCalls++;
    });
    const resolver = createChannelSettingResolver(db, 10_000);

    const [a, b] = await Promise.all([resolver("g1", "member"), resolver("g1", "member")]);

    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(selectCalls).toBe(1);
  });

  test("TTL経過後は再度SELECTする", async () => {
    let selectCalls = 0;
    const db = fakeDb([], { channelId: "c1" }, () => {
      selectCalls++;
    });
    const resolver = createChannelSettingResolver(db, 50);

    await resolver("g1", "member");
    await new Promise((resolve) => setTimeout(resolve, 100));
    await resolver("g1", "member");

    expect(selectCalls).toBe(2);
  });

  test("invalidateを呼ぶと、TTL満了前でも次回呼び出しで再度SELECTし新しい値を返す", async () => {
    let channelId = "c1";
    let selectCalls = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: () => {
            selectCalls++;
            return Promise.resolve([{ channelId }]);
          },
        }),
      }),
    } as unknown as Db;
    const resolver = createChannelSettingResolver(db, 10_000);

    expect(await resolver("g1", "member")).toBe("c1");
    expect(selectCalls).toBe(1);

    channelId = "c2"; // dashboard-apiが設定変更した想定
    resolver.invalidate?.("g1", "member");

    expect(await resolver("g1", "member")).toBe("c2");
    expect(selectCalls).toBe(2);
  });

  test("invalidateは指定したguildId×category以外のキャッシュに影響しない", async () => {
    let selectCalls = 0;
    const db = fakeDb([], { channelId: "c1" }, () => {
      selectCalls++;
    });
    const resolver = createChannelSettingResolver(db, 10_000);

    await resolver("g1", "member");
    await resolver("g2", "member");
    expect(selectCalls).toBe(2);

    resolver.invalidate?.("g1", "member");
    await resolver("g1", "member"); // invalidateされたので再SELECT
    await resolver("g2", "member"); // キャッシュヒットのままのはず

    expect(selectCalls).toBe(3);
  });
});

describe("formatLogEntry", () => {
  test("category/createdAt/カテゴリ固有フィールドを1行に整形する", () => {
    const line = formatLogEntry(memberJoinEntry);
    expect(line).toContain("[member]");
    expect(line).toContain("2026-08-31T00:00:00.000Z");
    expect(line).toContain("userId=u1");
    expect(line).toContain("action=join");
    expect(line).not.toContain("guildId=");
  });

  test("undefinedフィールドは出力しない", () => {
    const entry: LogEntry = {
      category: "autoMod",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      ruleId: "r1",
      userId: "u1",
      action: "actionExecuted",
    };
    expect(formatLogEntry(entry)).not.toContain("channelId=undefined");
  });

  test("改行を含む値は空白に置換する", () => {
    const entry: LogEntry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      action: "create",
      content: "line1\nline2\r\nline3",
    };
    expect(formatLogEntry(entry)).not.toMatch(/[\r\n]/);
  });

  test("長すぎる値はDiscordの本文上限内に切り詰める", () => {
    const entry: LogEntry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      action: "create",
      content: "x".repeat(5_000),
    };
    const line = formatLogEntry(entry);
    expect(line.length).toBeLessThanOrEqual(1_900);
    expect(line).toEndWith("…");
  });

  test("オブジェクト値(changes等)はJSON文字列化し、[object Object]にならない", () => {
    const entry: LogEntry = {
      category: "role",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      roleId: "r1",
      action: "update",
      changes: { name: { before: "old", after: "new" } },
    };
    const line = formatLogEntry(entry);
    expect(line).not.toContain("[object Object]");
    expect(line).toContain(`"before":"old"`);
    expect(line).toContain(`"after":"new"`);
  });
});
