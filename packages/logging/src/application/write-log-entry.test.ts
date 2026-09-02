import { describe, expect, mock, test } from "bun:test";
import type { Db } from "@management-bot/db";
import { logChannelSettings, logEntries } from "@management-bot/db";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { LogEntry } from "../domain/index.js";
import { formatLogEntry, writeLogEntry } from "./write-log-entry.js";

const pgDialect = new PgDialect();

interface RecordedInsert {
  table: unknown;
  values: unknown;
}

function fakeDb(
  inserts: RecordedInsert[],
  channelSetting: { channelId: string } | undefined,
  captureWhere?: (condition: SQL | undefined) => void,
): Db {
  return {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        return { onConflictDoNothing: () => Promise.resolve() };
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
});
