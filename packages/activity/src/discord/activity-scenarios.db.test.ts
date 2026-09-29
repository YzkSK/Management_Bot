import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { activityHourly, createDb, guilds } from "@management-bot/db";
import { asc, eq } from "drizzle-orm";
import { addHourlyActivity } from "../application/index.js";
import { isCounting, type VoiceStateSnapshot } from "../domain/index.js";
import { MessageCounter } from "./message-counter.js";
import { VoiceTracker } from "./voice-tracker.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");
const { db, close } = createDb(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const t = (iso: string) => new Date(iso);
const vc = (over: Partial<VoiceStateSnapshot> = {}): VoiceStateSnapshot => ({
  channelId: "vc",
  selfMute: false,
  selfDeaf: false,
  serverMute: false,
  serverDeaf: false,
  ...over,
});

beforeAll(async () => {
  await db.insert(guilds).values({ id: guildId, name: "guild" });
});
afterAll(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await close();
});

async function rowsOf(userId: string) {
  const rows = await db.select().from(activityHourly).where(eq(activityHourly.guildId, guildId)).orderBy(asc(activityHourly.hour));
  return rows.filter((r) => r.userId === userId).map((r) => [r.hour.toISOString(), r.messageCount, r.voiceSeconds]);
}

describe("アクティビティ記録シナリオ", () => {
  test("入室→ミュート→解除→移動→AFK移動→退室で、ミュート・AFK区間を除き時間分割して加算される", async () => {
    const tracker = new VoiceTracker((d) => addHourlyActivity(db, d));
    const step = (s: VoiceStateSnapshot, iso: string) => tracker.update(guildId, "u", isCounting(s, "afk"), t(iso));
    await step(vc(), "2026-09-29T10:40:00Z");
    await step(vc({ selfMute: true }), "2026-09-29T10:50:00Z");
    await step(vc(), "2026-09-29T11:00:00Z");
    await step(vc({ channelId: "vc2" }), "2026-09-29T11:10:00Z");
    await step(vc({ channelId: "afk" }), "2026-09-29T11:30:00Z");
    await step(vc({ channelId: null }), "2026-09-29T11:40:00Z");

    expect(await rowsOf("u")).toEqual([
      ["2026-09-29T10:00:00.000Z", 0, 600],
      ["2026-09-29T11:00:00.000Z", 0, 1800],
    ]);
  });

  test("停止時に在室中のVC区間と未flushの発言数が同じ時間行へ書き込まれる", async () => {
    const write = (d: Parameters<typeof addHourlyActivity>[1]) => addHourlyActivity(db, d);
    const tracker = new VoiceTracker(write);
    const counter = new MessageCounter(write);
    await tracker.update(guildId, "v", true, t("2026-09-29T12:00:00Z"));
    counter.record(guildId, "v", t("2026-09-29T12:05:00Z"));
    counter.record(guildId, "v", t("2026-09-29T12:06:00Z"));
    await Promise.all([tracker.closeAll(t("2026-09-29T12:30:00Z")), counter.flush()]);

    expect(await rowsOf("v")).toEqual([["2026-09-29T12:00:00.000Z", 2, 1800]]);
  });
});
