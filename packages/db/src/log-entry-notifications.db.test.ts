import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb } from "./client.js";
import { listenForLogEntryInserts, type LogEntryInsertNotification } from "./log-entry-notifications.js";
import { guilds, logEntries } from "./schema/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId = `test-guild-${randomUUID()}`;

let listener: { ready: Promise<void>; close: () => Promise<void> } | undefined;

afterAll(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await close();
});

beforeEach(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await db.insert(guilds).values({ id: guildId, name: "guild" });
});

afterEach(async () => {
  await listener?.close();
  listener = undefined;
});

function waitForNotification(
  timeoutMs = 5000,
): { notification: Promise<LogEntryInsertNotification>; onInsert: (n: LogEntryInsertNotification) => void } {
  let resolve!: (n: LogEntryInsertNotification) => void;
  let reject!: (e: Error) => void;
  const notification = new Promise<LogEntryInsertNotification>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const timer = setTimeout(() => reject(new Error("notification timed out")), timeoutMs);
  return {
    notification,
    onInsert: (n) => {
      clearTimeout(timer);
      resolve(n);
    },
  };
}

describe("listenForLogEntryInserts", () => {
  test("log_entriesへのINSERTでguildId/categoryを通知する", async () => {
    const { notification, onInsert } = waitForNotification();
    listener = listenForLogEntryInserts(databaseUrl, onInsert);
    await listener.ready;

    await db.insert(logEntries).values({
      id: randomUUID(),
      guildId,
      category: "message",
      payload: { category: "message", guildId, createdAt: new Date().toISOString(), channelId: "c1", authorId: "a1", action: "create" },
    });

    const result = await notification;
    expect(result).toEqual({ guildId, category: "message" });
  });

  test("カテゴリが変わっても正しいguildId/categoryを通知する", async () => {
    const { notification, onInsert } = waitForNotification();
    listener = listenForLogEntryInserts(databaseUrl, onInsert);
    await listener.ready;

    await db.insert(logEntries).values({
      id: randomUUID(),
      guildId,
      category: "voice",
      payload: { category: "voice", guildId, createdAt: new Date().toISOString(), userId: "u1", channelId: "c1", action: "join" },
    });

    const result = await notification;
    expect(result.guildId).toBe(guildId);
    expect(result.category).toBe("voice");
  });
});
