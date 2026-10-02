import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { activityHourly, createDb, guilds } from "@management-bot/db";
import { and, eq } from "drizzle-orm";
import { addHourlyActivity } from "./record-activity.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");
const { db, close } = createDb(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const hour = new Date("2026-09-29T10:00:00Z");

beforeAll(async () => {
  await db.insert(guilds).values({ id: guildId, name: "guild" });
});
afterAll(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await close();
});

async function row(userId: string) {
  const rows = await db
    .select()
    .from(activityHourly)
    .where(and(eq(activityHourly.guildId, guildId), eq(activityHourly.userId, userId), eq(activityHourly.hour, hour)));
  return rows[0];
}

describe("addHourlyActivity", () => {
  test("既存行に加算する", async () => {
    await addHourlyActivity(db, [{ guildId, userId: "u1", hour, messageCount: 2, voiceSeconds: 60 }]);
    await addHourlyActivity(db, [{ guildId, userId: "u1", hour, messageCount: 3, voiceSeconds: 0 }]);
    expect(await row("u1")).toMatchObject({ messageCount: 5, voiceSeconds: 60 });
  });

  test("同一キーが1回の呼び出しに複数あっても合算される(ON CONFLICTの同一行二重更新エラーにならない)", async () => {
    await addHourlyActivity(db, [
      { guildId, userId: "u2", hour, messageCount: 1, voiceSeconds: 10 },
      { guildId, userId: "u2", hour, messageCount: 1, voiceSeconds: 20 },
    ]);
    expect(await row("u2")).toMatchObject({ messageCount: 2, voiceSeconds: 30 });
  });

  test("空配列は何もしない", async () => {
    await expect(addHourlyActivity(db, [])).resolves.toBeUndefined();
  });
});
