import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createDb, guilds, logEntries } from "@management-bot/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { LogEntry } from "../domain/index.js";
import { writeLogEntry } from "./write-log-entry.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId = `test-guild-${randomUUID()}`;

afterAll(async () => {
  await db.delete(guilds);
  await close();
});

beforeEach(async () => {
  await db.delete(guilds);
  await db.insert(guilds).values({ id: guildId, name: "test guild" });
});

const memberJoinEntry: LogEntry = {
  category: "member",
  guildId,
  createdAt: "2026-08-31T00:00:00.000Z",
  userId: "u1",
  action: "join",
};

describe("writeLogEntry (実DB, onConflictDoNothingの実挙動を検証)", () => {
  test("同一idで再実行してもDB上のレコードは1件のまま(実際のconflict)で、送信は保存済みでも毎回試みる", async () => {
    const sendToChannel = mock(() => Promise.resolve());
    const id = randomUUID();

    await writeLogEntry({ db, sendToChannel }, memberJoinEntry, id);
    await writeLogEntry({ db, sendToChannel }, memberJoinEntry, id);

    const rows = await db.select().from(logEntries).where(eq(logEntries.id, id));
    expect(rows).toHaveLength(1);
    expect(sendToChannel).toHaveBeenCalledTimes(2);
  });
});
