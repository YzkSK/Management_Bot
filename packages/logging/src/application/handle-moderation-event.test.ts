import { describe, expect, mock, test } from "bun:test";
import type { Db } from "@management-bot/db";
import { logEntries } from "@management-bot/db";
import type { ModerationActionRecordedEvent } from "@management-bot/shared";
import { handleModerationEvent } from "./handle-moderation-event.js";

interface RecordedInsert {
  values: unknown;
}

/**
 * insertedIdsは「既にDBに存在するid」の集合として振る舞う擬似ストア。
 * 未登録idはinsert成功として登録し、登録済みidはconflict(returning: [])を返す。
 * 実際のonConflictDoNothingの挙動(初回成功・再実行時はスキップ)を1つのfakeDbで再現する。
 */
function fakeDb(
  inserts: RecordedInsert[],
  channelSetting: { channelId: string } | undefined,
  insertedIds: Set<string> = new Set(),
): Db {
  return {
    insert: () => ({
      values: (values: unknown) => {
        inserts.push({ values });
        const id = (values as { id: string }).id;
        return {
          onConflictDoNothing: () => ({
            returning: () => {
              if (insertedIds.has(id)) return Promise.resolve([]);
              insertedIds.add(id);
              return Promise.resolve([{ id }]);
            },
          }),
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(channelSetting ? [channelSetting] : []),
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
  test("moderationCaseカテゴリのログエントリとしてwriteLogEntryを呼ぶ。idはevent.typeを前置する", async () => {
    const inserts: RecordedInsert[] = [];
    const db = fakeDb(inserts, undefined);
    const sendToChannel = mock(() => Promise.resolve());
    const handler = handleModerationEvent({ db, sendToChannel });

    await handler(banEvent, "1234-0");

    expect(inserts[0]?.values).toMatchObject({
      id: "moderation.action.recorded:1234-0",
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
  });

  test("同一entryIdで再実行すると1回目はinsert+送信、2回目はconflictでinsertも送信もされない(冪等)", async () => {
    const inserts: RecordedInsert[] = [];
    const db = fakeDb(inserts, { channelId: "c1" });
    const sendToChannel = mock(() => Promise.resolve());
    const handler = handleModerationEvent({ db, sendToChannel });

    await handler(banEvent, "1234-0");
    await handler(banEvent, "1234-0");

    expect(inserts).toHaveLength(2);
    expect(sendToChannel).toHaveBeenCalledTimes(1);
  });

  test("log_entriesテーブルへinsertする", async () => {
    const inserts: { table: unknown }[] = [];
    const db = {
      insert: (table: unknown) => {
        inserts.push({ table });
        return {
          values: () => ({
            onConflictDoNothing: () => ({
              returning: () => Promise.resolve([{ id: "moderation.action.recorded:1234-0" }]),
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
