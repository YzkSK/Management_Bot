import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, guilds, scheduledPosts, syncFeatureMetadata } from "@management-bot/db";
import { eq } from "drizzle-orm";
import { claimDuePosts, markFailed, markPosted, purgeFinishedPosts, recoverStuckPosting } from "./scheduler-store.js";
import { getAllowedRoleIds, setAllowedRoleIds } from "./settings.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId = `test-guild-${randomUUID()}`;
const NOW = new Date("2026-10-05T03:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

afterAll(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await close();
});

beforeEach(async () => {
  await syncFeatureMetadata(db);
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await db.insert(guilds).values({ id: guildId, name: "test" });
});

async function insertPost(values: Partial<typeof scheduledPosts.$inferInsert> = {}) {
  const [row] = await db
    .insert(scheduledPosts)
    .values({ guildId, channelId: "c1", authorId: "u1", content: "hello", scheduledAt: at(-1), ...values })
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
}

describe("claimDuePosts", () => {
  test("時刻が来たpendingのみをposting(claim)にする", async () => {
    const due = await insertPost({ scheduledAt: at(-1) });
    const future = await insertPost({ scheduledAt: at(5) });

    const claimed = await claimDuePosts(db, NOW);

    expect(claimed.map((p) => p.id)).toEqual([due.id]);
    expect(claimed[0]?.status).toBe("posting");
    const [futureRow] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, future.id));
    expect(futureRow?.status).toBe("pending");
  });

  test("同じ予約は二重にclaimされない(並行実行しても1回だけ)", async () => {
    await insertPost();

    const results = await Promise.all([claimDuePosts(db, NOW), claimDuePosts(db, NOW), claimDuePosts(db, NOW)]);

    expect(results.flat()).toHaveLength(1);
  });
});

describe("markPosted / markFailed", () => {
  test("claim済み(posting)からのみ遷移し、二重遷移は無効", async () => {
    await insertPost();
    const [claimed] = await claimDuePosts(db, NOW);
    if (!claimed) throw new Error("not claimed");

    expect(await markPosted(db, claimed.id, "m1", NOW)).toMatchObject({ status: "posted", messageId: "m1" });
    expect(await markFailed(db, claimed.id, "send_failed", NOW)).toBeNull();
    expect(await markPosted(db, claimed.id, "m2", NOW)).toBeNull();
  });

  test("pendingのまま失敗にはできない", async () => {
    const post = await insertPost({ scheduledAt: at(10) });
    expect(await markFailed(db, post.id, "expired", NOW)).toBeNull();
  });
});

describe("recoverStuckPosting", () => {
  test("一定時間postingのまま残った予約はfailed/unknown_resultになる(再送しない)", async () => {
    const stuck = await insertPost({ status: "posting", updatedAt: at(-10) });
    // 別プロセスが処理中の可能性がある直近のpostingは触らない(ローリングデプロイ時の誤判定防止)。
    const inFlight = await insertPost({ status: "posting", updatedAt: at(-1) });
    const pending = await insertPost({ scheduledAt: at(10) });

    const recovered = await recoverStuckPosting(db, NOW);

    expect(recovered).toHaveLength(1);
    const [inFlightRow] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, inFlight.id));
    expect(inFlightRow?.status).toBe("posting");
    expect(recovered[0]).toMatchObject({ id: stuck.id, status: "failed", failureReason: "unknown_result" });
    const [pendingRow] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, pending.id));
    expect(pendingRow?.status).toBe("pending");
  });
});

describe("purgeFinishedPosts", () => {
  test("終了後30日を過ぎたposted/failed/cancelledのみ削除し、pendingは残す", async () => {
    const day = 86_400_000;
    const old = new Date(NOW.getTime() - 31 * day);
    const recent = new Date(NOW.getTime() - 29 * day);
    await insertPost({ status: "posted", finishedAt: old });
    await insertPost({ status: "failed", failureReason: "expired", finishedAt: old });
    await insertPost({ status: "cancelled", cancelledBy: "author", finishedAt: old });
    const keepRecent = await insertPost({ status: "posted", finishedAt: recent });
    const keepPending = await insertPost({ scheduledAt: at(-60 * 24 * 40) });

    expect(await purgeFinishedPosts(db, NOW)).toBe(3);

    const remaining = await db.select({ id: scheduledPosts.id }).from(scheduledPosts).where(eq(scheduledPosts.guildId, guildId));
    expect(remaining.map((r) => r.id).sort()).toEqual([keepRecent.id, keepPending.id].sort());
  });
});

describe("settings", () => {
  test("使えるロールは未設定なら空、設定・上書きできる", async () => {
    expect(await getAllowedRoleIds(db, guildId)).toEqual([]);
    await setAllowedRoleIds(db, guildId, ["r1", "r2", "r1"]);
    expect(await getAllowedRoleIds(db, guildId)).toEqual(["r1", "r2"]);
    await setAllowedRoleIds(db, guildId, []);
    expect(await getAllowedRoleIds(db, guildId)).toEqual([]);
  });
});
