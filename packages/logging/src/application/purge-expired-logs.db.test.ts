import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, guilds, logEntries, logRetentionSettings } from "@management-bot/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { purgeExpiredLogs, type PurgeExpiredLogsResult } from "./purge-expired-logs.js";

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

async function insertLogEntry(createdAt: Date, category = "message"): Promise<string> {
  const id = randomUUID();
  await db.insert(logEntries).values({ id, guildId, category, payload: {}, createdAt });
  return id;
}

/**
 * purgeExpiredLogsは全guild横断で削除するため、CI上でturborepoが他パッケージ
 * (logging-retention)のDB依存テストと並行実行されると、そちらが同時に挿入した
 * expired行まで削除結果に混ざる。このテストのguildId分だけを抽出して検証する。
 */
function forThisGuild(result: PurgeExpiredLogsResult[]): PurgeExpiredLogsResult[] {
  return result.filter((row) => row.guildId === guildId);
}

describe("purgeExpiredLogs (実DB)", () => {
  test("retentionDays=0(無期限)の設定はどれだけ古くても削除しない", async () => {
    await db.insert(logRetentionSettings).values({ guildId, category: "message", retentionDays: 0 });
    await insertLogEntry(new Date("2000-01-01T00:00:00.000Z"));

    const result = await purgeExpiredLogs(db, new Date("2026-08-31T00:00:00.000Z"));

    expect(forThisGuild(result)).toEqual([]);
    const remaining = await db.select().from(logEntries).where(eq(logEntries.guildId, guildId));
    expect(remaining).toHaveLength(1);
  });

  test("保持期間設定が存在しないguild×categoryは削除しない", async () => {
    await insertLogEntry(new Date("2000-01-01T00:00:00.000Z"));

    const result = await purgeExpiredLogs(db, new Date("2026-08-31T00:00:00.000Z"));

    expect(forThisGuild(result)).toEqual([]);
    const remaining = await db.select().from(logEntries).where(eq(logEntries.guildId, guildId));
    expect(remaining).toHaveLength(1);
  });

  test("境界値: ちょうど保持期間経過時点(isExpiredの仕様と一致)で削除される", async () => {
    await db.insert(logRetentionSettings).values({ guildId, category: "message", retentionDays: 7 });
    const id = await insertLogEntry(new Date("2026-01-01T00:00:00.000Z"));

    const result = await purgeExpiredLogs(db, new Date("2026-01-08T00:00:00.000Z"));

    expect(forThisGuild(result)).toEqual([{ guildId, category: "message", deletedCount: 1 }]);
    const remaining = await db.select().from(logEntries).where(eq(logEntries.id, id));
    expect(remaining).toHaveLength(0);
  });

  test("境界値: 保持期間経過の1ms手前(isExpiredの仕様と一致)は削除されない", async () => {
    await db.insert(logRetentionSettings).values({ guildId, category: "message", retentionDays: 7 });
    const id = await insertLogEntry(new Date("2026-01-01T00:00:00.000Z"));

    const result = await purgeExpiredLogs(db, new Date("2026-01-07T23:59:59.999Z"));

    expect(forThisGuild(result)).toEqual([]);
    const remaining = await db.select().from(logEntries).where(eq(logEntries.id, id));
    expect(remaining).toHaveLength(1);
  });

  test("保持期間内・保持期間外が混在する場合、期限切れのみ削除する", async () => {
    await db.insert(logRetentionSettings).values({ guildId, category: "message", retentionDays: 30 });
    const expiredId = await insertLogEntry(new Date("2026-01-01T00:00:00.000Z"));
    const freshId = await insertLogEntry(new Date("2026-08-30T00:00:00.000Z"));

    const result = await purgeExpiredLogs(db, new Date("2026-08-31T00:00:00.000Z"));

    expect(forThisGuild(result)).toEqual([{ guildId, category: "message", deletedCount: 1 }]);
    expect(await db.select().from(logEntries).where(eq(logEntries.id, expiredId))).toHaveLength(0);
    expect(await db.select().from(logEntries).where(eq(logEntries.id, freshId))).toHaveLength(1);
  });

  test("別categoryのretentionDaysには影響しない", async () => {
    await db.insert(logRetentionSettings).values([
      { guildId, category: "message", retentionDays: 7 },
      { guildId, category: "member", retentionDays: 0 },
    ]);
    const messageId = await insertLogEntry(new Date("2000-01-01T00:00:00.000Z"), "message");
    const memberId = await insertLogEntry(new Date("2000-01-01T00:00:00.000Z"), "member");

    await purgeExpiredLogs(db, new Date("2026-08-31T00:00:00.000Z"));

    expect(await db.select().from(logEntries).where(eq(logEntries.id, messageId))).toHaveLength(0);
    expect(await db.select().from(logEntries).where(eq(logEntries.id, memberId))).toHaveLength(1);
  });
});
