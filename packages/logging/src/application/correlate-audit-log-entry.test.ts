import { describe, expect, mock, test } from "bun:test";
import type { Db } from "@management-bot/db";
import { logEntries } from "@management-bot/db";
import type { AuditLogEntryInfo } from "./correlate-audit-log-entry.js";
import { correlateAuditLogEntry } from "./correlate-audit-log-entry.js";

interface RecordedInsert {
  table: unknown;
  values: unknown;
}

interface RecordedUpdate {
  table: unknown;
  set: unknown;
}

function fakeDb(options: {
  inserts: RecordedInsert[];
  updates: RecordedUpdate[];
  selectResult?: { id: string }[];
}): Db {
  const { inserts, updates, selectResult = [] } = options;
  return {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        return { onConflictDoNothing: () => Promise.resolve() };
      },
    }),
    select: () => ({
      from: () => ({
        // writeLogEntry(log_channel_settings向け)は`await ...where(...)`で直接解決するthenableとして、
        // correlateAuditLogEntry(log_entries向け)は`.orderBy().limit()`で解決するチェーンとして、
        // 同じwhere()の戻り値を両方から使えるようにする。
        where: () => ({
          then: (resolve: (rows: unknown[]) => void) => resolve([]),
          orderBy: () => ({
            limit: () => Promise.resolve(selectResult),
          }),
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (set: unknown) => {
        updates.push({ table, set });
        return { where: () => Promise.resolve() };
      },
    }),
  } as unknown as Db;
}

const baseEntry: AuditLogEntryInfo = {
  id: "audit-1",
  guildId: "g1",
  action: "ChannelDelete",
  executorId: "mod-1",
  targetId: "c1",
  createdAt: "2026-08-31T00:00:00.000Z",
};

describe("correlateAuditLogEntry", () => {
  test("常にauditLogCorrelationカテゴリの生ログを書き込む", async () => {
    const inserts: RecordedInsert[] = [];
    const updates: RecordedUpdate[] = [];
    const db = fakeDb({ inserts, updates, selectResult: [] });

    await correlateAuditLogEntry({ db, sendToChannel: mock(() => Promise.resolve()) }, baseEntry);

    expect(inserts[0]?.values).toMatchObject({
      category: "auditLogCorrelation",
      payload: {
        category: "auditLogCorrelation",
        auditLogEntryId: "audit-1",
        actionType: "ChannelDelete",
        targetId: "c1",
        executorId: "mod-1",
      },
    });
  });

  test("マッピング対象カテゴリで一致する行があればexecutorIdを追記するUPDATEを行う", async () => {
    const inserts: RecordedInsert[] = [];
    const updates: RecordedUpdate[] = [];
    const db = fakeDb({ inserts, updates, selectResult: [{ id: "log-1" }] });

    await correlateAuditLogEntry({ db, sendToChannel: mock(() => Promise.resolve()) }, baseEntry);

    expect(updates).toHaveLength(1);
    expect(updates[0]?.table).toBe(logEntries);
  });

  test("一致する行がなければUPDATEしない", async () => {
    const inserts: RecordedInsert[] = [];
    const updates: RecordedUpdate[] = [];
    const db = fakeDb({ inserts, updates, selectResult: [] });

    await correlateAuditLogEntry({ db, sendToChannel: mock(() => Promise.resolve()) }, baseEntry);

    expect(updates).toHaveLength(0);
  });

  test("executorIdがnullなら相関を試みない(auditLogCorrelationの生ログのみ書く)", async () => {
    const inserts: RecordedInsert[] = [];
    const updates: RecordedUpdate[] = [];
    const db = fakeDb({ inserts, updates, selectResult: [{ id: "log-1" }] });

    await correlateAuditLogEntry(
      { db, sendToChannel: mock(() => Promise.resolve()) },
      { ...baseEntry, executorId: null },
    );

    expect(inserts).toHaveLength(1);
    expect(updates).toHaveLength(0);
  });

  test("マッピングにない action は生ログのみ書いて何もしない", async () => {
    const inserts: RecordedInsert[] = [];
    const updates: RecordedUpdate[] = [];
    const db = fakeDb({ inserts, updates, selectResult: [{ id: "log-1" }] });

    await correlateAuditLogEntry(
      { db, sendToChannel: mock(() => Promise.resolve()) },
      { ...baseEntry, action: "MessagePin", targetId: "msg-author-id" },
    );

    expect(inserts).toHaveLength(1);
    expect(updates).toHaveLength(0);
  });

  test("IntegrationCreate/Update/Deleteは既存行への追記ではなくintegrationカテゴリを新規作成する", async () => {
    const inserts: RecordedInsert[] = [];
    const updates: RecordedUpdate[] = [];
    const db = fakeDb({ inserts, updates, selectResult: [{ id: "log-1" }] });

    await correlateAuditLogEntry(
      { db, sendToChannel: mock(() => Promise.resolve()) },
      { ...baseEntry, action: "IntegrationCreate", targetId: "integration-1" },
    );

    expect(inserts).toHaveLength(2);
    expect(inserts[1]?.values).toMatchObject({
      category: "integration",
      payload: { category: "integration", integrationId: "integration-1", action: "create", executorId: "mod-1" },
    });
    expect(updates).toHaveLength(0);
  });

  test("integration系でtargetId(integration id)がなければintegrationログは書かない", async () => {
    const inserts: RecordedInsert[] = [];
    const updates: RecordedUpdate[] = [];
    const db = fakeDb({ inserts, updates, selectResult: [] });

    await correlateAuditLogEntry(
      { db, sendToChannel: mock(() => Promise.resolve()) },
      { ...baseEntry, action: "IntegrationDelete", targetId: null },
    );

    expect(inserts).toHaveLength(1);
  });
});
