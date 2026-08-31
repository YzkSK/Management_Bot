import { describe, expect, mock, test } from "bun:test";
import type { Db } from "@management-bot/db";
import { logChannelSettings, logEntries } from "@management-bot/db";
import type { LogEntry } from "../domain/index.js";
import { formatLogEntry, writeLogEntry } from "./write-log-entry.js";

interface RecordedInsert {
  table: unknown;
  values: unknown;
}

function fakeDb(inserts: RecordedInsert[], channelSetting: { channelId: string } | undefined): Db {
  return {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(channelSetting ? [channelSetting] : []),
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

  test("出力先チャンネル設定があれば整形して送信する", async () => {
    const db = fakeDb([], { channelId: "c1" });
    const sendToChannel = mock(() => Promise.resolve());

    await writeLogEntry({ db, sendToChannel }, memberJoinEntry);

    expect(sendToChannel).toHaveBeenCalledWith("c1", formatLogEntry(memberJoinEntry));
  });

  test("select条件はguildIdとcategoryで絞り込む", async () => {
    let capturedTable: unknown;
    const db = {
      insert: () => ({ values: () => Promise.resolve() }),
      select: () => ({
        from: (table: unknown) => {
          capturedTable = table;
          return { where: () => Promise.resolve([]) };
        },
      }),
    } as unknown as Db;

    await writeLogEntry({ db, sendToChannel: mock(() => Promise.resolve()) }, memberJoinEntry);

    expect(capturedTable).toBe(logChannelSettings);
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
});
