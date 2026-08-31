import { describe, expect, test } from "bun:test";
import type { Db } from "@management-bot/db";
import { logEntries, logRetentionSettings } from "@management-bot/db";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { purgeExpiredLogs } from "./purge-expired-logs.js";

const pgDialect = new PgDialect();

interface Setting {
  guildId: string;
  category: string;
  retentionDays: number;
}

function fakeDb(
  settings: Setting[],
  deletedByGuildCategory: Record<string, { id: string }[]>,
  captureDeleteWhere?: (condition: SQL | undefined) => void,
): Db {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: SQL | undefined) => {
          if (table === logRetentionSettings) {
            const { sql } = pgDialect.sqlToQuery(condition!);
            expect(sql).toContain('"retention_days" > 0');
            return Promise.resolve(settings);
          }
          return Promise.resolve([]);
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: (condition: SQL | undefined) => ({
        returning: () => {
          if (table !== logEntries) return Promise.resolve([]);
          captureDeleteWhere?.(condition);
          const { params } = pgDialect.sqlToQuery(condition!);
          const key = `${params[0]}:${params[1]}`;
          return Promise.resolve(deletedByGuildCategory[key] ?? []);
        },
      }),
    }),
  } as unknown as Db;
}

describe("purgeExpiredLogs", () => {
  test("retentionDays>0の設定のみを対象にguild×categoryごとに削除する", async () => {
    const settings: Setting[] = [{ guildId: "g1", category: "message", retentionDays: 30 }];
    const db = fakeDb(settings, { "g1:message": [{ id: "e1" }, { id: "e2" }] });

    const result = await purgeExpiredLogs(db, new Date("2026-08-31T00:00:00.000Z"));

    expect(result).toEqual([{ guildId: "g1", category: "message", deletedCount: 2 }]);
  });

  test("削除件数0のguild×categoryは結果に含めない", async () => {
    const settings: Setting[] = [{ guildId: "g1", category: "message", retentionDays: 30 }];
    const db = fakeDb(settings, {});

    const result = await purgeExpiredLogs(db, new Date());

    expect(result).toEqual([]);
  });

  test("削除条件はguildId・category・createdAt<=cutoffのANDで絞り込む", async () => {
    const settings: Setting[] = [{ guildId: "g1", category: "message", retentionDays: 7 }];
    let captured: SQL | undefined;
    const db = fakeDb(settings, { "g1:message": [{ id: "e1" }] }, (condition) => {
      captured = condition;
    });

    await purgeExpiredLogs(db, new Date("2026-08-31T00:00:00.000Z"));

    const { sql, params } = pgDialect.sqlToQuery(captured!);
    expect(sql).toContain('"guild_id" = $1');
    expect(sql).toContain('"category" = $2');
    expect(sql).toContain('"created_at" <= $3');
    expect(params[0]).toBe("g1");
    expect(params[1]).toBe("message");
    expect(params[2]).toBe("2026-08-24T00:00:00.000Z");
  });

  test("複数guild×categoryをそれぞれ独立して処理する", async () => {
    const settings: Setting[] = [
      { guildId: "g1", category: "message", retentionDays: 30 },
      { guildId: "g2", category: "member", retentionDays: 7 },
    ];
    const db = fakeDb(settings, {
      "g1:message": [{ id: "e1" }],
      "g2:member": [{ id: "e2" }, { id: "e3" }],
    });

    const result = await purgeExpiredLogs(db, new Date());

    expect(result).toEqual([
      { guildId: "g1", category: "message", deletedCount: 1 },
      { guildId: "g2", category: "member", deletedCount: 2 },
    ]);
  });
});
