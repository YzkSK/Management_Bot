import { describe, expect, mock, test } from "bun:test";
import type { Db } from "@management-bot/db";
import { logEntries } from "@management-bot/db";
import { PgDialect } from "drizzle-orm/pg-core";
import type { AuditLogEntryInfo } from "./correlate-audit-log-entry.js";
import { correlateAuditLogEntry } from "./correlate-audit-log-entry.js";

const pgDialect = new PgDialect();

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
  /** UPDATEが実際に行を更新できたか(競り負けをシミュレートする場合はfalseを渡す)。省略時はtrue。 */
  updateSucceeds?: boolean;
}): Db {
  const { inserts, updates, selectResult = [], updateSucceeds = true } = options;
  return {
    insert: (table: unknown) => ({
      values: (values: { id: string }) => {
        inserts.push({ table, values });
        return { onConflictDoNothing: () => ({ returning: () => Promise.resolve([{ id: values.id }]) }) };
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
        return {
          where: () => ({
            returning: () => Promise.resolve(updateSucceeds ? selectResult.slice(0, 1) : []),
          }),
        };
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

// テストでは再試行の遅延(本番は2秒)を待たないよう0を渡す。
const NO_RETRY_DELAY = 0;

describe("correlateAuditLogEntry", () => {
  test("常にauditLogCorrelationカテゴリの生ログを書き込む", async () => {
    const inserts: RecordedInsert[] = [];
    const updates: RecordedUpdate[] = [];
    const db = fakeDb({ inserts, updates, selectResult: [] });

    await correlateAuditLogEntry({ db, sendToChannel: mock(() => Promise.resolve()) }, baseEntry, NO_RETRY_DELAY);

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

    await correlateAuditLogEntry({ db, sendToChannel: mock(() => Promise.resolve()) }, baseEntry, NO_RETRY_DELAY);

    expect(updates).toHaveLength(1);
    expect(updates[0]?.table).toBe(logEntries);
  });

  test("一致する行がなければUPDATEしない(1回リトライしても見つからない場合)", async () => {
    const inserts: RecordedInsert[] = [];
    const updates: RecordedUpdate[] = [];
    const db = fakeDb({ inserts, updates, selectResult: [] });

    await correlateAuditLogEntry({ db, sendToChannel: mock(() => Promise.resolve()) }, baseEntry, NO_RETRY_DELAY);

    expect(updates).toHaveLength(0);
  });

  test("executorIdがnullなら相関を試みない(auditLogCorrelationの生ログのみ書く)", async () => {
    const inserts: RecordedInsert[] = [];
    const updates: RecordedUpdate[] = [];
    const db = fakeDb({ inserts, updates, selectResult: [{ id: "log-1" }] });

    await correlateAuditLogEntry(
      { db, sendToChannel: mock(() => Promise.resolve()) },
      { ...baseEntry, executorId: null },
      NO_RETRY_DELAY,
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
      NO_RETRY_DELAY,
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
      NO_RETRY_DELAY,
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
      NO_RETRY_DELAY,
    );

    expect(inserts).toHaveLength(1);
  });

  test("MemberKickは相関時にpayload.actionをleave→kickへ書き換える", async () => {
    const inserts: RecordedInsert[] = [];
    const updates: RecordedUpdate[] = [];
    const db = fakeDb({ inserts, updates, selectResult: [{ id: "log-1" }] });

    await correlateAuditLogEntry(
      { db, sendToChannel: mock(() => Promise.resolve()) },
      { ...baseEntry, action: "MemberKick", targetId: "u1" },
      NO_RETRY_DELAY,
    );

    expect(updates).toHaveLength(1);
    const setValue = (updates[0]?.set as { payload: Parameters<typeof pgDialect.sqlToQuery>[0] }).payload;
    const { params } = pgDialect.sqlToQuery(setValue);
    expect(params).toContain("kick");
  });

  test("ThreadUpdateはupdate/archive/unarchiveのいずれかに一致すれば相関する(候補action群)", async () => {
    const inserts: RecordedInsert[] = [];
    const updates: RecordedUpdate[] = [];
    const db = fakeDb({ inserts, updates, selectResult: [{ id: "log-1" }] });

    await correlateAuditLogEntry(
      { db, sendToChannel: mock(() => Promise.resolve()) },
      { ...baseEntry, action: "ThreadUpdate", targetId: "t1" },
      NO_RETRY_DELAY,
    );

    expect(updates).toHaveLength(1);
  });

  test("MemberRoleUpdateはroleChangesのaddedをmemberAdd行に、removedをmemberRemove行に相関する", async () => {
    const inserts: RecordedInsert[] = [];
    const updates: RecordedUpdate[] = [];
    const db = fakeDb({ inserts, updates, selectResult: [{ id: "log-1" }] });

    await correlateAuditLogEntry(
      { db, sendToChannel: mock(() => Promise.resolve()) },
      {
        ...baseEntry,
        action: "MemberRoleUpdate",
        targetId: "u1",
        roleChanges: { added: ["r1"], removed: ["r2"] },
      },
      NO_RETRY_DELAY,
    );

    // added 1件 + removed 1件 = 2回のUPDATE
    expect(updates).toHaveLength(2);
  });

  test("候補行への注釈が並行イベントに競り負けたら(0件更新)、除外して別候補にリトライする", async () => {
    const inserts: RecordedInsert[] = [];
    const updates: RecordedUpdate[] = [];
    const selectCalls: unknown[] = [];
    const updateWhereCalls: unknown[] = [];
    let selectCallCount = 0;
    const db = {
      insert: () => ({
        values: (values: { id: string }) => {
          inserts.push({ table: undefined, values });
          return { onConflictDoNothing: () => ({ returning: () => Promise.resolve([{ id: values.id }]) }) };
        },
      }),
      select: () => ({
        from: () => ({
          where: (whereArg: unknown) => {
            selectCalls.push(whereArg);
            return {
              then: (resolve: (rows: unknown[]) => void) => resolve([]),
              orderBy: () => ({
                // 1回目はlog-1、リトライ(2回目)はlog-2を候補として返す(実際は除外条件で
                // log-1がSQL側で弾かれるが、ここではモックなので呼び出し回数で切り替える)。
                limit: () => {
                  selectCallCount += 1;
                  return Promise.resolve(selectCallCount === 1 ? [{ id: "log-1" }] : [{ id: "log-2" }]);
                },
              }),
            };
          },
        }),
      }),
      update: () => ({
        set: (set: unknown) => {
          updates.push({ table: logEntries, set });
          return {
            where: (whereArg: unknown) => {
              updateWhereCalls.push(whereArg);
              // log-1は他イベントに競り負けて0件更新、log-2は成功する想定。
              return { returning: () => Promise.resolve(updates.length === 1 ? [] : [{ id: "log-2" }]) };
            },
          };
        },
      }),
    } as unknown as Db;

    await correlateAuditLogEntry({ db, sendToChannel: mock(() => Promise.resolve()) }, baseEntry, 0);

    expect(updates).toHaveLength(2);
    // writeLogEntryのlogChannelSettings参照1回 + findUnannotatedRowの初回・リトライで2回 = 3回。
    expect(selectCalls).toHaveLength(3);
  });

  test("MessageDeleteはchannelId+authorId(targetId)で一致するmessage delete行に相関する", async () => {
    const inserts: RecordedInsert[] = [];
    const updates: RecordedUpdate[] = [];
    const db = fakeDb({ inserts, updates, selectResult: [{ id: "log-1" }] });

    await correlateAuditLogEntry(
      { db, sendToChannel: mock(() => Promise.resolve()) },
      { ...baseEntry, action: "MessageDelete", targetId: "author-1", messageDeleteChannelId: "channel-1" },
      NO_RETRY_DELAY,
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]?.table).toBe(logEntries);
  });

  test("MessageDeleteはmessageDeleteChannelIdがなければ相関しない", async () => {
    const inserts: RecordedInsert[] = [];
    const updates: RecordedUpdate[] = [];
    const db = fakeDb({ inserts, updates, selectResult: [{ id: "log-1" }] });

    await correlateAuditLogEntry(
      { db, sendToChannel: mock(() => Promise.resolve()) },
      { ...baseEntry, action: "MessageDelete", targetId: "author-1", messageDeleteChannelId: undefined },
      NO_RETRY_DELAY,
    );

    expect(updates).toHaveLength(0);
  });

  test("MemberRoleUpdateでroleChangesが無ければ何もしない", async () => {
    const inserts: RecordedInsert[] = [];
    const updates: RecordedUpdate[] = [];
    const db = fakeDb({ inserts, updates, selectResult: [{ id: "log-1" }] });

    await correlateAuditLogEntry(
      { db, sendToChannel: mock(() => Promise.resolve()) },
      { ...baseEntry, action: "MemberRoleUpdate", targetId: "u1", roleChanges: undefined },
      NO_RETRY_DELAY,
    );

    expect(updates).toHaveLength(0);
  });
});
