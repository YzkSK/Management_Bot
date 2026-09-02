import { describe, expect, test } from "bun:test";
import type { Db } from "@management-bot/db";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { purgeExpiredLogs } from "./purge-expired-logs.js";

const pgDialect = new PgDialect();

function fakeDb(
  rows: { guild_id: string; category: string; deleted_count: number }[],
  captureQuery?: (sql: string, params: unknown[]) => void,
): Db {
  return {
    execute: (query: SQL) => {
      const { sql, params } = pgDialect.sqlToQuery(query);
      captureQuery?.(sql, params);
      return Promise.resolve(rows);
    },
  } as unknown as Db;
}

describe("purgeExpiredLogs", () => {
  test("削除された行をguild×categoryごとの結果に変換する", async () => {
    const db = fakeDb([
      { guild_id: "g1", category: "message", deleted_count: 2 },
      { guild_id: "g2", category: "member", deleted_count: 1 },
    ]);

    const result = await purgeExpiredLogs(db, new Date("2026-08-31T00:00:00.000Z"));

    expect(result).toEqual([
      { guildId: "g1", category: "message", deletedCount: 2 },
      { guildId: "g2", category: "member", deletedCount: 1 },
    ]);
  });

  test("削除対象がなければ空配列を返す", async () => {
    const db = fakeDb([]);

    const result = await purgeExpiredLogs(db, new Date());

    expect(result).toEqual([]);
  });

  test("retentionDays>0の条件・guild_id/category一致・created_atのカットオフをSQLに含む", async () => {
    let capturedSql = "";
    let capturedParams: unknown[] = [];
    const db = fakeDb([], (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
    });

    await purgeExpiredLogs(db, new Date("2026-08-31T00:00:00.000Z"));

    expect(capturedSql).toContain("retention_days");
    expect(capturedSql).toContain("> 0");
    expect(capturedSql).toContain("guild_id");
    expect(capturedSql).toContain("category");
    expect(capturedSql).toContain("interval");
    expect(capturedSql.toUpperCase()).toContain("GROUP BY");
    expect(capturedParams).toContain("2026-08-31T00:00:00.000Z");
  });
});
