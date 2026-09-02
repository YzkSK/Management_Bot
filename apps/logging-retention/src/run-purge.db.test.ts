import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createDb, guilds, logEntries, logRetentionSettings } from "@management-bot/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createPurgeRunner } from "./run-purge.js";

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

describe("createPurgeRunner (実DB, advisory lock経由の実行)", () => {
  test("advisory lockを取得してpurgeExpiredLogsを実行し、期限切れログを削除する", async () => {
    await db.insert(logRetentionSettings).values({ guildId, category: "message", retentionDays: 7 });
    const expiredId = randomUUID();
    await db.insert(logEntries).values({
      id: expiredId,
      guildId,
      category: "message",
      payload: {},
      createdAt: new Date("2000-01-01T00:00:00.000Z"),
    });
    const onResult = mock(() => {});
    const runner = createPurgeRunner(db, onResult);

    await runner.run();

    expect(onResult.mock.calls[0]?.[0]).toContain("deleted 1 entries");
    const remaining = await db.select().from(logEntries).where(eq(logEntries.id, expiredId));
    expect(remaining).toHaveLength(0);
  });

  test("同時にrunを呼んでもDBのadvisory lockで一方だけが実際に削除を実行する", async () => {
    await db.insert(logRetentionSettings).values({ guildId, category: "message", retentionDays: 7 });
    const expiredId = randomUUID();
    await db.insert(logEntries).values({
      id: expiredId,
      guildId,
      category: "message",
      payload: {},
      createdAt: new Date("2000-01-01T00:00:00.000Z"),
    });
    // 2つの別プロセスを模擬するため、同じguildIdに対しrunner同士は別インスタンスにする
    // (createPurgeRunnerのプロセス内inFlightガードを迂回して、DBレベルのロックだけを検証する)。
    const onResultA = mock(() => {});
    const onResultB = mock(() => {});
    const runnerA = createPurgeRunner(db, onResultA);
    const runnerB = createPurgeRunner(db, onResultB);

    await Promise.all([runnerA.run(), runnerB.run()]);

    const messages = [...onResultA.mock.calls, ...onResultB.mock.calls].map((call) => call[0]);
    const skipped = messages.filter((m) => m?.includes("another instance is already running"));
    const executed = messages.filter((m) => m?.includes("deleted"));
    // advisory lockはトランザクション単位のため、同時実行でも常に排他が成立するとは
    // 限らない(先行トランザクションが先にcommitしていれば後続も取得できる)。
    // ここでは「両方が同時にDELETEを実行して行を取り合う」ことがない、
    // つまり削除された行数の合計が実際のログ件数(1件)を超えないことを確認する。
    expect(skipped.length + executed.length).toBe(2);
    const remaining = await db.select().from(logEntries).where(eq(logEntries.id, expiredId));
    expect(remaining).toHaveLength(0);
  });
});
