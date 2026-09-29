import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { activityDaily, activityHourly, createDb, guilds } from "@management-bot/db";
import { eq } from "drizzle-orm";
import { getMemberDetail, getMemberRanking, getServerSummary } from "./queries.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");
const { db, close } = createDb(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const t = (iso: string) => new Date(iso);
const NOW = t("2026-09-29T12:00:00Z");
const WEEK_FROM = t("2026-09-27T15:00:00Z"); // JST 9/28 0時

beforeAll(async () => {
  await db.insert(guilds).values({ id: guildId, name: "guild" });
  await db.insert(activityHourly).values([
    { guildId, userId: "a", hour: t("2026-09-28T14:00:00Z"), messageCount: 3, voiceSeconds: 600 }, // JST 9/28 23時
    { guildId, userId: "a", hour: t("2026-09-28T15:00:00Z"), messageCount: 1, voiceSeconds: 1200 }, // JST 9/29 0時
    { guildId, userId: "b", hour: t("2026-09-29T01:00:00Z"), messageCount: 10, voiceSeconds: 0 },
  ]);
  await db.insert(activityDaily).values([{ guildId, userId: "a", day: "2026-06-01", messageCount: 5, voiceSeconds: 100 }]);
});
afterAll(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await close();
});

describe("getServerSummary", () => {
  test("日別はJSTの日付で集約する", async () => {
    const r = await getServerSummary(db, { guildId, from: WEEK_FROM, to: NOW, granularity: "day" });
    expect(r.series).toEqual([
      { bucket: "2026-09-28", messageCount: 3, voiceSeconds: 600 },
      { bucket: "2026-09-29", messageCount: 11, voiceSeconds: 1200 },
    ]);
    expect(r.totals).toEqual({ messageCount: 14, voiceSeconds: 1800, activeMembers: 2 });
  });

  test("時間別はUTCの時間先頭をISO文字列で返す", async () => {
    const r = await getServerSummary(db, { guildId, from: t("2026-09-28T14:00:00Z"), to: t("2026-09-28T16:00:00Z"), granularity: "hour" });
    expect(r.series).toEqual([
      { bucket: "2026-09-28T14:00:00.000Z", messageCount: 3, voiceSeconds: 600 },
      { bucket: "2026-09-28T15:00:00.000Z", messageCount: 1, voiceSeconds: 1200 },
    ]);
  });

  test("ロールアップ済みの日次と時間単位を跨ぐ範囲では両方を合算する", async () => {
    const r = await getServerSummary(db, { guildId, from: t("2026-05-31T15:00:00Z"), to: NOW, granularity: "day" });
    expect(r.totals.messageCount).toBe(19);
    expect(r.series[0]).toEqual({ bucket: "2026-06-01", messageCount: 5, voiceSeconds: 100 });
  });

  test("活動が無ければ0と空の推移", async () => {
    const r = await getServerSummary(db, { guildId, from: t("2026-01-01T00:00:00Z"), to: t("2026-01-02T00:00:00Z"), granularity: "day" });
    expect(r).toEqual({ totals: { messageCount: 0, voiceSeconds: 0, activeMembers: 0 }, series: [] });
  });
});

describe("getMemberRanking", () => {
  test("指定列の降順で並び、総数を返す", async () => {
    const r = await getMemberRanking(db, { guildId, from: WEEK_FROM, to: NOW, sort: "messages", limit: 10, offset: 0 });
    expect(r.rows.map((x) => x.userId)).toEqual(["b", "a"]);
    expect(r.rows[1]).toEqual({ userId: "a", messageCount: 4, voiceSeconds: 1800, lastActiveAt: "2026-09-28T15:00:00.000Z" });
    expect(r.total).toBe(2);
  });

  test("offsetでページングする", async () => {
    const r = await getMemberRanking(db, { guildId, from: WEEK_FROM, to: NOW, sort: "voice", limit: 1, offset: 1 });
    expect(r.rows.map((x) => x.userId)).toEqual(["b"]);
    expect(r.total).toBe(2);
  });
});

describe("getMemberDetail", () => {
  test("合計・順位・JST時間帯分布・日別・最終活動を返す", async () => {
    const r = await getMemberDetail(db, { guildId, userId: "a", from: WEEK_FROM, to: NOW });
    expect(r.totals).toEqual({ messageCount: 4, voiceSeconds: 1800 });
    expect(r.rank).toEqual({ messages: 2, voice: 1 });
    expect(r.byHourOfDay.messageCount).toHaveLength(24);
    expect(r.byHourOfDay.messageCount[23]).toBe(3);
    expect(r.byHourOfDay.messageCount[0]).toBe(1);
    expect(r.byHourOfDay.voiceSeconds[0]).toBe(1200);
    expect(r.daily).toEqual([
      { bucket: "2026-09-28", messageCount: 3, voiceSeconds: 600 },
      { bucket: "2026-09-29", messageCount: 1, voiceSeconds: 1200 },
    ]);
    expect(r.lastMessageAt).toBe("2026-09-28T15:00:00.000Z");
    expect(r.lastVoiceAt).toBe("2026-09-28T15:00:00.000Z");
  });

  test("活動の無い順位はnull、活動が無ければ最終活動もnull", async () => {
    const b = await getMemberDetail(db, { guildId, userId: "b", from: WEEK_FROM, to: NOW });
    expect(b.rank).toEqual({ messages: 1, voice: null });
    expect(b.lastVoiceAt).toBeNull();
    const nobody = await getMemberDetail(db, { guildId, userId: "z", from: WEEK_FROM, to: NOW });
    expect(nobody.rank).toEqual({ messages: null, voice: null });
    expect(nobody.lastMessageAt).toBeNull();
  });
});
