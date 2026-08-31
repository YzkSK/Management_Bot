import { describe, expect, mock, test } from "bun:test";
import type { Db } from "@management-bot/db";
import { logEntries } from "@management-bot/db";
import type { ModerationActionRecordedEvent } from "@management-bot/shared";
import { handleModerationEvent } from "./handle-moderation-event.js";

interface RecordedInsert {
  values: unknown;
}

function fakeDb(inserts: RecordedInsert[], insertReturns: { id: string }[] = [{ id: "generated" }]): Db {
  return {
    insert: () => ({
      values: (values: unknown) => {
        inserts.push({ values });
        return {
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve(insertReturns),
          }),
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
  } as unknown as Db;
}

const banEvent: ModerationActionRecordedEvent = {
  type: "moderation.action.recorded",
  guildId: "g1",
  caseId: "case-1",
  targetUserId: "u1",
  moderatorId: "mod1",
  action: "create",
  actionType: "ban",
  createdAt: "2026-08-31T00:00:00.000Z",
};

describe("handleModerationEvent", () => {
  test("moderationCaseカテゴリのログエントリとしてwriteLogEntryを呼ぶ", async () => {
    const inserts: RecordedInsert[] = [];
    const db = fakeDb(inserts);
    const sendToChannel = mock(() => Promise.resolve());
    const handler = handleModerationEvent({ db, sendToChannel });

    await handler(banEvent, "1234-0");

    expect(inserts[0]?.values).toMatchObject({
      id: "1234-0",
      guildId: "g1",
      category: "moderationCase",
      payload: {
        category: "moderationCase",
        caseId: "case-1",
        targetUserId: "u1",
        moderatorId: "mod1",
        action: "create",
        actionType: "ban",
      },
    });
    expect(inserts[0]?.values).toMatchObject({ id: "1234-0" });
  });

  test("同一entryIdで再実行されても重複保存しない(冪等)", async () => {
    const db = fakeDb([], []);
    const sendToChannel = mock(() => Promise.resolve());
    const handler = handleModerationEvent({ db, sendToChannel });

    await handler(banEvent, "1234-0");

    expect(sendToChannel).not.toHaveBeenCalled();
  });

  test("log_entriesテーブルへinsertする", async () => {
    const inserts: { table: unknown }[] = [];
    const db = {
      insert: (table: unknown) => {
        inserts.push({ table });
        return {
          values: () => ({
            onConflictDoNothing: () => ({
              returning: () => Promise.resolve([{ id: "1234-0" }]),
            }),
          }),
        };
      },
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    } as unknown as Db;
    const handler = handleModerationEvent({ db, sendToChannel: mock(() => Promise.resolve()) });

    await handler(banEvent, "1234-0");

    expect(inserts[0]?.table).toBe(logEntries);
  });
});
