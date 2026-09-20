import { describe, expect, mock, test } from "bun:test";
import type { Db } from "@management-bot/db";
import { logEntries } from "@management-bot/db";
import type { ModerationActionRecordedEvent } from "@management-bot/shared";
import { handleModerationEvent } from "./handle-moderation-event.js";

interface RecordedInsert {
  values: unknown;
}

interface RecordedUpdate {
  set: unknown;
}

function fakeDb(
  inserts: RecordedInsert[],
  updates: RecordedUpdate[],
  channelSetting: { channelId: string } | undefined,
  /** UPDATEが対象行に一致したかどうか(false=更新0件、insertへフォールバックする経路を再現)。 */
  updateMatchesExistingRow = true,
): Db {
  return {
    insert: () => ({
      values: (values: { id: string }) => {
        inserts.push({ values });
        return { onConflictDoNothing: () => ({ returning: () => Promise.resolve([{ id: values.id }]) }) };
      },
    }),
    update: () => ({
      set: (set: unknown) => {
        updates.push({ set });
        return { where: () => ({ returning: () => Promise.resolve(updateMatchesExistingRow ? [{ id: "case-1:u1" }] : []) }) };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(channelSetting ? [channelSetting] : []),
      }),
    }),
  } as unknown as Db;
}

const createEvent: ModerationActionRecordedEvent = {
  type: "moderation.action.recorded",
  guildId: "g1",
  caseId: "case-1",
  targetUserId: "u1",
  moderatorId: "mod1",
  action: "create",
  actionType: "ban",
  createdAt: "2026-08-31T00:00:00.000Z",
};

const resolveSuccessEvent: ModerationActionRecordedEvent = {
  type: "moderation.action.recorded",
  guildId: "g1",
  caseId: "case-1",
  targetUserId: "u1",
  moderatorId: "mod1",
  action: "resolve",
  actionType: "ban",
  result: "success",
  createdAt: "2026-08-31T00:00:05.000Z",
};

const resolveFailedEvent: ModerationActionRecordedEvent = {
  ...resolveSuccessEvent,
  result: "failed",
  failureCode: "discord_api_error",
};

describe("handleModerationEvent", () => {
  test("action=createはcaseIdをidとして新規insertする", async () => {
    const inserts: RecordedInsert[] = [];
    const updates: RecordedUpdate[] = [];
    const db = fakeDb(inserts, updates, undefined);
    const sendToChannel = mock(() => Promise.resolve());
    const handler = handleModerationEvent({ db, sendToChannel });

    await handler(createEvent, "1234-0");

    expect(inserts[0]?.values).toMatchObject({
      id: "case-1:u1",
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
    expect(updates).toHaveLength(0);
  });

  test("action=resolveは同一caseId(=同一id)の既存行をUPDATEする(insertしない)", async () => {
    const inserts: RecordedInsert[] = [];
    const updates: RecordedUpdate[] = [];
    const db = fakeDb(inserts, updates, undefined);
    const sendToChannel = mock(() => Promise.resolve());
    const handler = handleModerationEvent({ db, sendToChannel });

    await handler(resolveSuccessEvent, "1234-1");

    expect(inserts).toHaveLength(0);
    expect(updates[0]?.set).toMatchObject({
      payload: { action: "resolve", caseId: "case-1", result: "success" },
    });
  });

  test("resolveがcreateより先に(または単独で)処理された場合、更新0件ならresolveの内容でinsertする(#350)", async () => {
    const inserts: RecordedInsert[] = [];
    const updates: RecordedUpdate[] = [];
    const db = fakeDb(inserts, updates, { channelId: "c1" }, false);
    const sendToChannel = mock(() => Promise.resolve());
    const handler = handleModerationEvent({ db, sendToChannel });

    await handler(resolveSuccessEvent, "1234-1");

    expect(updates).toHaveLength(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.values).toMatchObject({
      id: "case-1:u1",
      payload: { action: "resolve", caseId: "case-1", result: "success" },
    });
    // insertフォールバック経路ではwriteLogEntry(保存の都度チャンネル送信)は使わないため、
    // result=successでは送信されない(通常のresult=failed判定のみに従う)。
    expect(sendToChannel).not.toHaveBeenCalled();
  });

  test("resolveでresult=successの場合はDiscordへ送信しない(createで既に1通送信済みのため)", async () => {
    const inserts: RecordedInsert[] = [];
    const updates: RecordedUpdate[] = [];
    const db = fakeDb(inserts, updates, { channelId: "c1" });
    const sendToChannel = mock(() => Promise.resolve());
    const handler = handleModerationEvent({ db, sendToChannel });

    await handler(resolveSuccessEvent, "1234-1");

    expect(sendToChannel).not.toHaveBeenCalled();
  });

  test("resolveでresult=failedの場合はDiscordへ追加通知を送る", async () => {
    const inserts: RecordedInsert[] = [];
    const updates: RecordedUpdate[] = [];
    const db = fakeDb(inserts, updates, { channelId: "c1" });
    const sendToChannel = mock(() => Promise.resolve());
    const handler = handleModerationEvent({ db, sendToChannel });

    await handler(resolveFailedEvent, "1234-1");

    expect(sendToChannel).toHaveBeenCalledTimes(1);
    expect(sendToChannel).toHaveBeenCalledWith("c1", expect.objectContaining({ suppressMentions: true }));
  });

  test("createはlog_entriesテーブルへinsertする", async () => {
    const insertedTables: unknown[] = [];
    const db = {
      insert: (table: unknown) => {
        insertedTables.push(table);
        return {
          values: () => ({
            onConflictDoNothing: () => ({ returning: () => Promise.resolve([{ id: "x" }]) }),
          }),
        };
      },
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    } as unknown as Db;
    const handler = handleModerationEvent({ db, sendToChannel: mock(() => Promise.resolve()) });

    await handler(createEvent, "1234-0");

    expect(insertedTables[0]).toBe(logEntries);
  });

  test("削除済みguildへのログ書き込みが外部キー違反なら、イベントを再試行対象に残さない", async () => {
    const missingGuildError = Object.assign(new Error("guild was deleted"), {
      code: "23503",
      constraint_name: "log_entries_guild_id_guilds_id_fk",
    });
    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({ returning: () => Promise.reject(missingGuildError) }),
        }),
      }),
    } as unknown as Db;
    const handler = handleModerationEvent({ db, sendToChannel: mock(() => Promise.resolve()) });

    await expect(handler(createEvent, "1234-0")).resolves.toBeUndefined();
  });
});
