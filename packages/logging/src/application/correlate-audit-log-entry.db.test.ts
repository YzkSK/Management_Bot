import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, guilds, logEntries } from "@management-bot/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { AuditLogEntryInfo } from "./correlate-audit-log-entry.js";
import { correlateAuditLogEntry } from "./correlate-audit-log-entry.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId = `test-guild-${randomUUID()}`;
const noopSendToChannel = () => Promise.resolve();
// テストでは再試行の遅延(本番は2秒)を待たないよう0を渡す。
const NO_RETRY_DELAY = 0;

afterAll(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await close();
});

beforeEach(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await db.insert(guilds).values({ id: guildId, name: "test guild" });
});

async function insertChannelLogEntry(
  channelId: string,
  createdAt: Date,
  overrides: { action?: string; executorId?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await db.insert(logEntries).values({
    id,
    guildId,
    category: "channel",
    payload: {
      category: "channel",
      guildId,
      createdAt: createdAt.toISOString(),
      channelId,
      action: overrides.action ?? "delete",
      ...(overrides.executorId ? { executorId: overrides.executorId } : {}),
    },
    createdAt,
  });
  return id;
}

async function insertMemberLogEntry(userId: string, action: string, createdAt: Date): Promise<string> {
  const id = randomUUID();
  await db.insert(logEntries).values({
    id,
    guildId,
    category: "member",
    payload: { category: "member", guildId, createdAt: createdAt.toISOString(), userId, action },
    createdAt,
  });
  return id;
}

async function insertRoleLogEntry(roleId: string, userId: string, action: string, createdAt: Date): Promise<string> {
  const id = randomUUID();
  await db.insert(logEntries).values({
    id,
    guildId,
    category: "role",
    payload: { category: "role", guildId, createdAt: createdAt.toISOString(), roleId, userId, action },
    createdAt,
  });
  return id;
}

describe("correlateAuditLogEntry (実DB)", () => {
  test("一致するchannelログ行が見つかればpayloadにexecutorIdを追記する", async () => {
    const logId = await insertChannelLogEntry("c1", new Date("2026-08-31T00:00:00.000Z"));
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "ChannelDelete",
      executorId: "mod-1",
      targetId: "c1",
      createdAt: "2026-08-31T00:00:05.000Z",
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [row] = await db.select().from(logEntries).where(eq(logEntries.id, logId));
    expect(row?.payload).toMatchObject({ executorId: "mod-1" });
  });

  test("時間窓(前後30秒)を超えた古いログ行には追記しない", async () => {
    const logId = await insertChannelLogEntry("c1", new Date("2026-08-31T00:00:00.000Z"));
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "ChannelDelete",
      executorId: "mod-1",
      targetId: "c1",
      createdAt: "2026-08-31T00:05:00.000Z",
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [row] = await db.select().from(logEntries).where(eq(logEntries.id, logId));
    expect(row?.payload).not.toMatchObject({ executorId: "mod-1" });
  });

  test("時間窓を超えて未来のログ行(監査ログより後に書き込まれた別操作)には追記しない", async () => {
    const logId = await insertChannelLogEntry("c1", new Date("2026-08-31T00:05:00.000Z"));
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "ChannelDelete",
      executorId: "mod-1",
      targetId: "c1",
      createdAt: "2026-08-31T00:00:00.000Z",
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [row] = await db.select().from(logEntries).where(eq(logEntries.id, logId));
    expect(row?.payload).not.toMatchObject({ executorId: "mod-1" });
  });

  test("payload.actionが一致しない行(同一チャンネルの直前のupdate)には追記しない", async () => {
    const updateLogId = await insertChannelLogEntry("c1", new Date("2026-08-31T00:00:00.000Z"), { action: "update" });
    const deleteLogId = await insertChannelLogEntry("c1", new Date("2026-08-31T00:00:01.000Z"), { action: "delete" });
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "ChannelDelete",
      executorId: "mod-1",
      targetId: "c1",
      createdAt: "2026-08-31T00:00:02.000Z",
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [updateRow] = await db.select().from(logEntries).where(eq(logEntries.id, updateLogId));
    const [deleteRow] = await db.select().from(logEntries).where(eq(logEntries.id, deleteLogId));
    expect(updateRow?.payload).not.toMatchObject({ executorId: "mod-1" });
    expect(deleteRow?.payload).toMatchObject({ executorId: "mod-1" });
  });

  test("既にexecutorIdが設定済みの行は上書きしない", async () => {
    const logId = await insertChannelLogEntry("c1", new Date("2026-08-31T00:00:00.000Z"), { executorId: "original-mod" });
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "ChannelDelete",
      executorId: "mod-1",
      targetId: "c1",
      createdAt: "2026-08-31T00:00:05.000Z",
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [row] = await db.select().from(logEntries).where(eq(logEntries.id, logId));
    expect(row?.payload).toMatchObject({ executorId: "original-mod" });
  });

  test("常にauditLogCorrelationカテゴリの生ログを別行として保存する", async () => {
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "ChannelDelete",
      executorId: "mod-1",
      targetId: "c1",
      createdAt: "2026-08-31T00:00:00.000Z",
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [row] = await db
      .select()
      .from(logEntries)
      .where(eq(logEntries.category, "auditLogCorrelation"));
    expect(row?.payload).toMatchObject({ auditLogEntryId: entry.id, actionType: "ChannelDelete", executorId: "mod-1" });
  });

  test("IntegrationCreateはintegrationカテゴリの行を新規作成する", async () => {
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "IntegrationCreate",
      executorId: "mod-1",
      targetId: "integration-1",
      createdAt: "2026-08-31T00:00:00.000Z",
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [row] = await db.select().from(logEntries).where(eq(logEntries.category, "integration"));
    expect(row?.payload).toMatchObject({ integrationId: "integration-1", action: "create", executorId: "mod-1" });
  });

  test("MemberKickは相関時にleave行のactionをkickへ書き換える", async () => {
    const logId = await insertMemberLogEntry("u1", "leave", new Date("2026-08-31T00:00:00.000Z"));
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "MemberKick",
      executorId: "mod-1",
      targetId: "u1",
      createdAt: "2026-08-31T00:00:05.000Z",
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [row] = await db.select().from(logEntries).where(eq(logEntries.id, logId));
    expect(row?.payload).toMatchObject({ executorId: "mod-1", action: "kick" });
  });

  test("ThreadUpdateはarchiveアクションの行にも相関する(候補action群のいずれかに一致すればよい)", async () => {
    const threadLogId = randomUUID();
    await db.insert(logEntries).values({
      id: threadLogId,
      guildId,
      category: "thread",
      payload: {
        category: "thread",
        guildId,
        createdAt: "2026-08-31T00:00:00.000Z",
        threadId: "t1",
        channelId: "c1",
        action: "archive",
      },
      createdAt: new Date("2026-08-31T00:00:00.000Z"),
    });
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "ThreadUpdate",
      executorId: "mod-1",
      targetId: "t1",
      createdAt: "2026-08-31T00:00:05.000Z",
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [row] = await db.select().from(logEntries).where(eq(logEntries.id, threadLogId));
    expect(row?.payload).toMatchObject({ executorId: "mod-1" });
  });

  test("MemberRoleUpdateはroleId+userIdの複合一致でmemberAdd/memberRemove行に相関する", async () => {
    const addedLogId = await insertRoleLogEntry("r1", "u1", "memberAdd", new Date("2026-08-31T00:00:00.000Z"));
    const removedLogId = await insertRoleLogEntry("r2", "u1", "memberRemove", new Date("2026-08-31T00:00:00.000Z"));
    // 同じr1ロールを別ユーザーに付与した行は対象外であることも確認する
    const otherUserLogId = await insertRoleLogEntry("r1", "u2", "memberAdd", new Date("2026-08-31T00:00:00.000Z"));
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "MemberRoleUpdate",
      executorId: "mod-1",
      targetId: "u1",
      createdAt: "2026-08-31T00:00:05.000Z",
      roleChanges: { added: ["r1"], removed: ["r2"] },
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [addedRow] = await db.select().from(logEntries).where(eq(logEntries.id, addedLogId));
    const [removedRow] = await db.select().from(logEntries).where(eq(logEntries.id, removedLogId));
    const [otherUserRow] = await db.select().from(logEntries).where(eq(logEntries.id, otherUserLogId));
    expect(addedRow?.payload).toMatchObject({ executorId: "mod-1" });
    expect(removedRow?.payload).toMatchObject({ executorId: "mod-1" });
    expect(otherUserRow?.payload).not.toMatchObject({ executorId: "mod-1" });
  });

  test("元イベントの書き込みが監査ログより少し遅れて完了しても、1回のリトライで拾って相関する", async () => {
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "ChannelDelete",
      executorId: "mod-1",
      targetId: "c-race",
      createdAt: new Date().toISOString(),
    };

    const correlationPromise = correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, 300);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const logId = await insertChannelLogEntry("c-race", new Date());
    await correlationPromise;

    const [row] = await db.select().from(logEntries).where(eq(logEntries.id, logId));
    expect(row?.payload).toMatchObject({ executorId: "mod-1" });
  });
});
