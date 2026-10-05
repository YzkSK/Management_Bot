import { describe, expect, mock, test } from "bun:test";
import type { Db } from "@management-bot/db";
import type { ScheduledPostEventRecordedEvent } from "@management-bot/shared";
import { handleScheduledPostEvent } from "./handle-scheduled-post-event.js";

function fakeDb(inserts: unknown[]): Db {
  return {
    insert: () => ({
      values: (values: { id: string }) => {
        inserts.push(values);
        return { onConflictDoNothing: () => ({ returning: () => Promise.resolve([{ id: values.id }]) }) };
      },
    }),
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  } as unknown as Db;
}

const base = {
  type: "scheduled-post.event.recorded" as const,
  guildId: "g1",
  postId: "p1",
  channelId: "c1",
  authorId: "u1",
  createdAt: "2026-09-22T00:00:00.000Z",
};

describe("handleScheduledPostEvent", () => {
  test("editedはbefore/afterをcontent/previousContentに平坦化し、entryIdを冪等キーにする", async () => {
    const inserts: unknown[] = [];
    const handler = handleScheduledPostEvent({ db: fakeDb(inserts), sendToChannel: mock(() => Promise.resolve()) });
    const event: ScheduledPostEventRecordedEvent = {
      ...base,
      action: "edited",
      before: { content: "old", scheduledAt: "2026-10-01T00:00:00.000Z" },
      after: { content: "new", scheduledAt: "2026-10-02T00:00:00.000Z" },
    };

    await handler(event, "1-0");

    expect(inserts[0]).toMatchObject({
      id: "scheduled-post.event.recorded:1-0",
      category: "scheduledPost",
      payload: {
        category: "scheduledPost",
        action: "edited",
        content: "new",
        previousContent: "old",
        scheduledAt: "2026-10-02T00:00:00.000Z",
        previousScheduledAt: "2026-10-01T00:00:00.000Z",
      },
    });
  });

  test("failedは原因を、管理者取り消しは実行者を保持する", async () => {
    const inserts: unknown[] = [];
    const handler = handleScheduledPostEvent({ db: fakeDb(inserts), sendToChannel: mock(() => Promise.resolve()) });

    await handler({ ...base, action: "failed", reason: "author_left", scheduledAt: "2026-10-01T00:00:00.000Z" }, "1-1");
    await handler(
      { ...base, action: "cancelled", by: "admin", executorId: "u9", scheduledAt: "2026-10-01T00:00:00.000Z" },
      "1-2",
    );

    expect(inserts[0]).toMatchObject({ payload: { action: "failed", reason: "author_left" } });
    expect(inserts[1]).toMatchObject({ payload: { action: "cancelled", by: "admin", executorId: "u9" } });
  });

  test("削除済みguildの外部キー違反は再試行対象に残さない", async () => {
    const error = Object.assign(new Error("fk"), { code: "23503", constraint_name: "log_entries_guild_id_guilds_id_fk" });
    const db = {
      insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: () => Promise.reject(error) }) }) }),
    } as unknown as Db;
    const handler = handleScheduledPostEvent({ db, sendToChannel: mock(() => Promise.resolve()) });

    await expect(
      handler({ ...base, action: "posted", messageId: "m1", scheduledAt: "2026-10-01T00:00:00.000Z" }, "1-3"),
    ).resolves.toBeUndefined();
  });
});
