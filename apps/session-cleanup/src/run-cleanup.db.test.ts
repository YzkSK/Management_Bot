import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createDb, sessions } from "@management-bot/db";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createCleanupRunner } from "./run-cleanup.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const expiredId = `session-expired-${randomUUID()}`;

afterAll(async () => {
  await db.delete(sessions).where(eq(sessions.id, expiredId));
  await close();
});

beforeEach(async () => {
  await db.delete(sessions).where(eq(sessions.id, expiredId));
  await db.insert(sessions).values({
    id: expiredId,
    discordUserId: "user-1",
    discordUsername: "user1",
    encryptedAccessToken: "a",
    encryptedRefreshToken: "r",
    expiresAt: new Date("2000-01-01T00:00:00.000Z"),
  });
});

async function remaining(): Promise<number> {
  const rows = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, expiredId));
  return rows.length;
}

describe("createCleanupRunner (実DB, advisory lock経由の実行)", () => {
  test("advisory lockを取得してpurgeExpiredSessionsを実行し、期限切れセッションを削除する", async () => {
    const onResult = mock(() => {});
    const runner = createCleanupRunner(db, onResult);

    await runner.run();

    expect(onResult.mock.calls[0]?.[0]).toMatch(/^Session cleanup job: deleted \d+ expired sessions$/);
    expect(await remaining()).toBe(0);
  });

  test("他のトランザクションが同じadvisory lockを保持している間は削除をスキップする", async () => {
    const onResult = mock(() => {});
    const runner = createCleanupRunner(db, onResult);
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();

    // 別インスタンスが実行中の状態を、同じキーのロックを保持したトランザクションで模擬する。
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(869412504)`);
      locked.resolve();
      await release.promise;
    });
    await locked.promise;

    try {
      await runner.run();
    } finally {
      release.resolve();
      await holder;
    }

    expect(onResult.mock.calls[0]?.[0]).toContain("another instance is already running");
    expect(await remaining()).toBe(1);
  });
});
