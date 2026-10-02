import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { activityDaily, activityHourly, createDb, guilds } from "@management-bot/db";
import { asc, eq } from "drizzle-orm";
import { rollupOldHourly } from "./rollup.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");
const { db, close } = createDb(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const t = (iso: string) => new Date(iso);
// cutoff = JST 7/1 0時(= 2026-06-30T15:00Z)
const NOW = t("2026-09-29T12:00:00Z");

beforeAll(async () => {
  await db.insert(guilds).values({ id: guildId, name: "guild" });
  await db.insert(activityHourly).values([
    { guildId, userId: "u", hour: t("2026-06-30T13:00:00Z"), messageCount: 1, voiceSeconds: 100 }, // JST 6/30 22時
    { guildId, userId: "u", hour: t("2026-06-30T14:00:00Z"), messageCount: 2, voiceSeconds: 200 }, // JST 6/30 23時
    { guildId, userId: "u", hour: t("2026-06-30T15:00:00Z"), messageCount: 4, voiceSeconds: 400 }, // JST 7/1 0時(対象外)
  ]);
  await db.insert(activityDaily).values([{ guildId, userId: "u", day: "2026-06-30", messageCount: 10, voiceSeconds: 1000 }]);
});
afterAll(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await close();
});

describe("rollupOldHourly", () => {
  test("cutoffより前の時間行をJST日付の日次行へ加算して削除し、以降の行は残す", async () => {
    const moved = await rollupOldHourly(db, NOW);
    expect(moved).toBeGreaterThanOrEqual(1);

    const daily = await db.select().from(activityDaily).where(eq(activityDaily.guildId, guildId));
    expect(daily.map((d) => [d.day, d.messageCount, d.voiceSeconds])).toEqual([["2026-06-30", 13, 1300]]);
    const hourly = await db.select().from(activityHourly).where(eq(activityHourly.guildId, guildId)).orderBy(asc(activityHourly.hour));
    expect(hourly.map((h) => h.hour.toISOString())).toEqual(["2026-06-30T15:00:00.000Z"]);
  });

  test("2回目の実行では何も変わらない", async () => {
    await rollupOldHourly(db, NOW);
    const daily = await db.select().from(activityDaily).where(eq(activityDaily.guildId, guildId));
    expect(daily.map((d) => [d.day, d.messageCount, d.voiceSeconds])).toEqual([["2026-06-30", 13, 1300]]);
  });
});
