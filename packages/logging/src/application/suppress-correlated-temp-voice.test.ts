import { describe, expect, mock, test } from "bun:test";
import type { Db } from "@management-bot/db";
import { logEntries } from "@management-bot/db";
import { TEMP_VOICE_UPDATE_REASON } from "@management-bot/shared";
import type { AuditLogEntryInfo } from "./correlate-audit-log-entry.js";
import { correlateAuditLogEntry } from "./correlate-audit-log-entry.js";

interface RecordedDelete {
  table: unknown;
  id: string;
}

function fakeDb(options: { selectResult: { id: string }[]; deletes: RecordedDelete[]; inserts?: unknown[] }): Db {
  const { selectResult, deletes, inserts } = options;
  return {
    insert: () => ({
      values: (values: { id: string }) => {
        inserts?.push(values);
        return { onConflictDoNothing: () => ({ returning: () => Promise.resolve([{ id: values.id }]) }) };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectResult),
          orderBy: () => ({ limit: () => Promise.resolve(selectResult) }),
        }),
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        // selectResultは1件の想定なのでその id を記録する(実クエリのwhere条件は検証しない、単体テストの範囲外)。
        deletes.push({ table, id: selectResult[0]?.id ?? "" });
        return Promise.resolve();
      },
    }),
    // reason不一致時、後続のCORRELATION_RULES処理(findUnannotatedRow→annotateRow)がエラーなく完了するためのダミー実装。
    update: () => ({
      set: () => ({
        where: () => ({ returning: () => Promise.resolve([]) }),
      }),
    }),
  } as unknown as Db;
}

const tempVoiceReasonEntry: AuditLogEntryInfo = {
  id: "audit-1",
  guildId: "g1",
  action: "ChannelUpdate",
  executorId: "mod-1",
  targetId: "c1",
  createdAt: "2026-09-22T00:00:00.000Z",
  reason: TEMP_VOICE_UPDATE_REASON,
};

describe("correlateAuditLogEntry: 一時VC重複抑制のフォールバック(#413)", () => {
  test("reasonが一時VC由来かつ対象channel行が1件に絞れれば削除し、auditLogCorrelationも書き込まない", async () => {
    const deletes: RecordedDelete[] = [];
    const inserts: unknown[] = [];
    const db = fakeDb({ selectResult: [{ id: "log-1" }], deletes, inserts });

    await correlateAuditLogEntry({ db, sendToChannel: mock(() => Promise.resolve()) }, tempVoiceReasonEntry);

    expect(deletes).toEqual([{ table: logEntries, id: "log-1" }]);
    expect(inserts).toHaveLength(0);
  });

  test("reasonが一時VC由来でも対象channel行が複数(絞り込めない)なら何もしない", async () => {
    const deletes: RecordedDelete[] = [];
    const db = fakeDb({ selectResult: [{ id: "log-1" }, { id: "log-2" }], deletes });

    await correlateAuditLogEntry({ db, sendToChannel: mock(() => Promise.resolve()) }, tempVoiceReasonEntry);

    expect(deletes).toHaveLength(0);
  });

  test("reasonが一時VC由来でも対象channel行が0件なら何もしない", async () => {
    const deletes: RecordedDelete[] = [];
    const db = fakeDb({ selectResult: [], deletes });

    await correlateAuditLogEntry({ db, sendToChannel: mock(() => Promise.resolve()) }, tempVoiceReasonEntry);

    expect(deletes).toHaveLength(0);
  });

  test("reasonが一時VC由来でなければ削除しない(マッピングにないactionで後続の相関処理も素通りさせる)", async () => {
    const deletes: RecordedDelete[] = [];
    const db = fakeDb({ selectResult: [{ id: "log-1" }], deletes });

    await correlateAuditLogEntry(
      { db, sendToChannel: mock(() => Promise.resolve()) },
      { ...tempVoiceReasonEntry, action: "MessagePin", reason: "some other reason" },
    );

    expect(deletes).toHaveLength(0);
  });
});
