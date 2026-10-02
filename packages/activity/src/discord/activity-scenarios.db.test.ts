import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { activityHourly, createDb, guilds } from "@management-bot/db";
import { asc, eq } from "drizzle-orm";
import { addHourlyActivity } from "../application/index.js";
import { isCounting, type VoiceStateSnapshot } from "../domain/index.js";
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

  test("入室→checkpoint→退室で二重計上しない(画面の加算は now − countingSince)", async () => {
    const tracker = new VoiceTracker((d) => addHourlyActivity(db, d));
    await tracker.update(guildId, "w", true, t("2026-09-29T13:00:00Z"));
    expect(await tracker.checkpoint(t("2026-09-29T13:01:00Z"))).toEqual([{ guildId, userId: "w" }]);
    expect(tracker.countingSince(guildId, "w")).toEqual(t("2026-09-29T13:01:00Z"));
    expect(await rowsOf("w")).toEqual([["2026-09-29T13:00:00.000Z", 0, 60]]);
    await tracker.update(guildId, "w", false, t("2026-09-29T13:01:30Z"));

    expect(await rowsOf("w")).toEqual([["2026-09-29T13:00:00.000Z", 0, 90]]);
  });
});
