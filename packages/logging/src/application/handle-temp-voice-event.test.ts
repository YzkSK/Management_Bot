import { describe, expect, mock, test } from "bun:test";
import type { Db } from "@management-bot/db";
import { logEntries } from "@management-bot/db";
import type { TempVoiceEventRecordedEvent } from "@management-bot/shared";
import { handleTempVoiceEvent } from "./handle-temp-voice-event.js";

interface RecordedInsert {
  values: unknown;
}

function fakeDb(inserts: RecordedInsert[], channelSetting: { channelId: string } | undefined): Db {
  return {
    insert: () => ({
      values: (values: { id: string }) => {
        inserts.push({ values });
        return { onConflictDoNothing: () => ({ returning: () => Promise.resolve([{ id: values.id }]) }) };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(channelSetting ? [channelSetting] : []),
      }),
    }),
  } as unknown as Db;
}

const createdEvent: TempVoiceEventRecordedEvent = {
  type: "temp-voice.event.recorded",
  guildId: "g1",
  channelId: "c1",
  createdAt: "2026-09-22T00:00:00.000Z",
  action: "created",
  ownerId: "u1",
  ownerName: "owner",
  controlChannelId: "ctrl1",
};

describe("handleTempVoiceEvent", () => {
  test("entryIdを冪等キーとして書き込む(type:entryId形式)", async () => {
    const inserts: RecordedInsert[] = [];
    const db = fakeDb(inserts, undefined);
    const sendToChannel = mock(() => Promise.resolve());
    const handler = handleTempVoiceEvent({ db, sendToChannel });

    await handler(createdEvent, "1234-0");

    expect(inserts[0]?.values).toMatchObject({
      id: "temp-voice.event.recorded:1234-0",
      guildId: "g1",
      category: "tempVoice",
      payload: {
        category: "tempVoice",
        channelId: "c1",
        action: "created",
        ownerId: "u1",
        controlChannelId: "ctrl1",
      },
    });
  });

  test("log_entriesテーブルへinsertする", async () => {
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
    const handler = handleTempVoiceEvent({ db, sendToChannel: mock(() => Promise.resolve()) });

    await handler(createdEvent, "1234-0");

    expect(insertedTables[0]).toBe(logEntries);
  });

  test("通知先チャンネルが設定されていればDiscordへ送信する(全actionが通知対象)", async () => {
    const inserts: RecordedInsert[] = [];
    const db = fakeDb(inserts, { channelId: "notify-ch" });
    const sendToChannel = mock(() => Promise.resolve());
    const handler = handleTempVoiceEvent({ db, sendToChannel });

    await handler(createdEvent, "1234-0");

    expect(sendToChannel).toHaveBeenCalledTimes(1);
    expect(sendToChannel).toHaveBeenCalledWith("notify-ch", expect.objectContaining({ suppressMentions: true }));
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
    const handler = handleTempVoiceEvent({ db, sendToChannel: mock(() => Promise.resolve()) });

    await expect(handler(createdEvent, "1234-0")).resolves.toBeUndefined();
  });
});
