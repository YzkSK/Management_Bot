import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, guilds, logEntries } from "@management-bot/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { findPendingPolls } from "./find-pending-polls.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId = `test-guild-${randomUUID()}`;

afterAll(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await close();
});

beforeEach(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await db.insert(guilds).values({ id: guildId, name: "test guild" });
});

async function insertPollLogEntry(action: "create" | "end", messageId: string, createdAt: Date, channelId = "c1"): Promise<void> {
  await db.insert(logEntries).values({
    id: randomUUID(),
    guildId,
    category: "poll",
    payload: { category: "poll", guildId, createdAt: createdAt.toISOString(), messageId, channelId, action },
    createdAt,
  });
}

describe("findPendingPolls (実DB)", () => {
  test("createのみでendが無いpollを返す", async () => {
    await insertPollLogEntry("create", "m1", new Date("2026-08-31T00:00:00.000Z"));

    const result = await findPendingPolls(db, new Date("2026-08-31T00:10:00.000Z"));

    expect(result).toEqual([{ guildId, channelId: "c1", messageId: "m1" }]);
  });

  test("endが既にあるpollは返さない", async () => {
    await insertPollLogEntry("create", "m1", new Date("2026-08-31T00:00:00.000Z"));
    await insertPollLogEntry("end", "m1", new Date("2026-08-31T00:05:00.000Z"));

    const result = await findPendingPolls(db, new Date("2026-08-31T00:10:00.000Z"));

    expect(result).toEqual([]);
  });

  test("遡及期間(7日)を超えて古いcreateは返さない", async () => {
    await insertPollLogEntry("create", "m1", new Date("2026-08-01T00:00:00.000Z"));

    const result = await findPendingPolls(db, new Date("2026-08-31T00:00:00.000Z"));

    expect(result).toEqual([]);
  });
});
