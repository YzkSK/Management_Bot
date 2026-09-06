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

/**
 * 固定の過去日付(例: 2026-01-01)で作った行は、テスト側が指定するnow(判定基準時刻)より
 * 前でも、実際のシステム時刻(他ファイルのrun-purge.db.test.ts等が`new Date()`で呼ぶ
 * purgeExpiredLogsの実行時刻)から見るとすでに期限切れになり得る。purgeExpiredLogsは
 * 全guild横断で削除するため、CI上で並行実行される他テストのpurgeに巻き込まれて
 * このテストの行が消されてしまう(実際に発生した不安定化の原因)。
 * 判定基準時刻(now)からの相対日付でcreatedAtを組み立てることで、他テストが実行する
 * 「実時刻基準のpurge」でも境界を跨がない限り消えないようにする。
 */
function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

describe("purgeExpiredLogs (実DB)", () => {
  test("retentionDays=0(無期限)の設定はどれだけ古くても削除しない", async () => {
    const now = new Date();
    await db.insert(logRetentionSettings).values({ guildId, category: "message", retentionDays: 0 });
    await insertLogEntry(daysBefore(now, 3650));

    const result = await purgeExpiredLogs(db, now);

    expect(forThisGuild(result)).toEqual([]);
    const remaining = await db.select().from(logEntries).where(eq(logEntries.guildId, guildId));
    expect(remaining).toHaveLength(1);
  });

  test("保持期間設定が存在しないguild×categoryは削除しない", async () => {
    const now = new Date();
    await insertLogEntry(daysBefore(now, 3650));

    const result = await purgeExpiredLogs(db, now);

    expect(forThisGuild(result)).toEqual([]);
    const remaining = await db.select().from(logEntries).where(eq(logEntries.guildId, guildId));
    expect(remaining).toHaveLength(1);
  });

  test("境界値: ちょうど保持期間経過時点(isExpiredの仕様と一致)で削除される", async () => {
    const now = new Date();
    await db.insert(logRetentionSettings).values({ guildId, category: "message", retentionDays: 7 });
    const id = await insertLogEntry(daysBefore(now, 7));

    const result = await purgeExpiredLogs(db, now);

    expect(forThisGuild(result)).toEqual([{ guildId, category: "message", deletedCount: 1 }]);
    const remaining = await db.select().from(logEntries).where(eq(logEntries.id, id));
    expect(remaining).toHaveLength(0);
  });

  test("境界値: 保持期間経過の1ms手前(isExpiredの仕様と一致)は削除されない", async () => {
    const now = new Date();
    await db.insert(logRetentionSettings).values({ guildId, category: "message", retentionDays: 7 });
    const id = await insertLogEntry(new Date(daysBefore(now, 7).getTime() + 1));

    const result = await purgeExpiredLogs(db, now);

    expect(forThisGuild(result)).toEqual([]);
    const remaining = await db.select().from(logEntries).where(eq(logEntries.id, id));
    expect(remaining).toHaveLength(1);
  });

  test("保持期間内・保持期間外が混在する場合、期限切れのみ削除する", async () => {
    const now = new Date();
    await db.insert(logRetentionSettings).values({ guildId, category: "message", retentionDays: 30 });
    const expiredId = await insertLogEntry(daysBefore(now, 31));
    const freshId = await insertLogEntry(daysBefore(now, 1));

    const result = await purgeExpiredLogs(db, now);

    expect(forThisGuild(result)).toEqual([{ guildId, category: "message", deletedCount: 1 }]);
    expect(await db.select().from(logEntries).where(eq(logEntries.id, expiredId))).toHaveLength(0);
    expect(await db.select().from(logEntries).where(eq(logEntries.id, freshId))).toHaveLength(1);
  });

  test("別categoryのretentionDaysには影響しない", async () => {
    const now = new Date();
    await db.insert(logRetentionSettings).values([
      { guildId, category: "message", retentionDays: 7 },
      { guildId, category: "member", retentionDays: 0 },
    ]);
    const messageId = await insertLogEntry(daysBefore(now, 3650), "message");
    const memberId = await insertLogEntry(daysBefore(now, 3650), "member");

    await purgeExpiredLogs(db, now);

    expect(await db.select().from(logEntries).where(eq(logEntries.id, messageId))).toHaveLength(0);
    expect(await db.select().from(logEntries).where(eq(logEntries.id, memberId))).toHaveLength(1);
  });
});
