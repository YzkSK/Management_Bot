import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createDb } from "./client.js";
import { guilds, scheduledPosts } from "./schema/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId = `test-guild-${randomUUID()}`;

const migrationSql = readFileSync(new URL("../drizzle/0038_backfill_author_cancel_notified.sql", import.meta.url), "utf8");

afterAll(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await close();
});

beforeEach(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await db.insert(guilds).values({ id: guildId, name: "guild" });
});

describe("0038_backfill_author_cancel_notified", () => {
  test("未通知の本人取り消しだけcancel_notified_atをfinished_atで埋め、管理者取り消しは触らない", async () => {
    const finishedAt = new Date("2026-10-01T00:00:00.000Z");
    const base = { guildId, channelId: "c1", authorId: "u1", content: "x", scheduledAt: finishedAt, status: "cancelled" as const, finishedAt };
    const [author, admin] = [randomUUID(), randomUUID()];
    await db.insert(scheduledPosts).values([
      { ...base, id: author, cancelledBy: "author" },
      { ...base, id: admin, cancelledBy: "admin" },
    ]);

    // migrationはテーブル全体を更新するため、他のテストの行に影響しないようトランザクション内で実行してロールバックする。
    const rollback = new Error("rollback");
    let rows: (typeof scheduledPosts.$inferSelect)[] = [];
    await db
      .transaction(async (tx) => {
        await tx.execute(sql.raw(migrationSql));
        rows = await tx.select().from(scheduledPosts).where(eq(scheduledPosts.guildId, guildId));
        throw rollback;
      })
      .catch((error: unknown) => {
        if (error !== rollback) throw error;
      });

    expect(rows.find((r) => r.id === author)?.cancelNotifiedAt?.toISOString()).toBe(finishedAt.toISOString());
    expect(rows.find((r) => r.id === admin)?.cancelNotifiedAt).toBeNull();
  });
});
