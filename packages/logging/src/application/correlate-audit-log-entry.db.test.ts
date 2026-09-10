import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, guilds, logEntries } from "@management-bot/db";
import { and, eq } from "drizzle-orm";
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

async function insertInviteLogEntry(code: string, action: string, createdAt: Date): Promise<string> {
  const id = randomUUID();
  await db.insert(logEntries).values({
    id,
    guildId,
    category: "invite",
    payload: { category: "invite", guildId, createdAt: createdAt.toISOString(), channelId: "c1", code, action },
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

/**
 * action=moveの場合はvoiceLogEntrySchema上previousChannelIdが必須、action=updateの場合はchangesが
 * 必須のため、overridesで指定する。
 */
async function insertVoiceLogEntry(
  userId: string,
  channelId: string,
  action: string,
  createdAt: Date,
  overrides: { previousChannelId?: string; changes?: Record<string, { before: boolean; after: boolean }> } = {},
): Promise<string> {
  const id = randomUUID();
  await db.insert(logEntries).values({
    id,
    guildId,
    category: "voice",
    payload: {
      category: "voice",
      guildId,
      createdAt: createdAt.toISOString(),
      userId,
      channelId,
      action,
      ...(overrides.previousChannelId ? { previousChannelId: overrides.previousChannelId } : {}),
      ...(overrides.changes ? { changes: overrides.changes } : {}),
    },
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

  test("executorNameが渡されればpayloadにexecutorIdと一緒に追記する", async () => {
    const logId = await insertChannelLogEntry("c1", new Date("2026-08-31T00:00:00.000Z"));
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "ChannelDelete",
      executorId: "mod-1",
      executorName: "モデレーター太郎",
      targetId: "c1",
      createdAt: "2026-08-31T00:00:05.000Z",
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [row] = await db.select().from(logEntries).where(eq(logEntries.id, logId));
    expect(row?.payload).toMatchObject({ executorId: "mod-1", executorName: "モデレーター太郎" });
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
      // 本番データにも同カテゴリの行が存在しうるため、guildId(このテスト専用のランダムUUID)
      // でも絞り込み、無関係な行を誤って拾わないようにする(codexレビュー指摘: guildIdスコープ漏れ)。
      .where(and(eq(logEntries.category, "auditLogCorrelation"), eq(logEntries.guildId, guildId)));
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

    const [row] = await db
      .select()
      .from(logEntries)
      .where(and(eq(logEntries.category, "integration"), eq(logEntries.guildId, guildId)));
    expect(row?.payload).toMatchObject({ integrationId: "integration-1", action: "create", executorId: "mod-1" });
  });

  test("InviteCreateはtargetId(招待コード)でinvite行にexecutorIdを追記する", async () => {
    const logId = await insertInviteLogEntry("abc123", "create", new Date("2026-08-31T00:00:00.000Z"));
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "InviteCreate",
      executorId: "mod-1",
      targetId: "abc123",
      createdAt: "2026-08-31T00:00:05.000Z",
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [row] = await db.select().from(logEntries).where(eq(logEntries.id, logId));
    expect(row?.payload).toMatchObject({ executorId: "mod-1" });
  });

  test("InviteDeleteはtargetId(招待コード)でinvite行にexecutorIdを追記する", async () => {
    const logId = await insertInviteLogEntry("abc123", "delete", new Date("2026-08-31T00:00:00.000Z"));
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "InviteDelete",
      executorId: "mod-1",
      targetId: "abc123",
      createdAt: "2026-08-31T00:00:05.000Z",
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [row] = await db.select().from(logEntries).where(eq(logEntries.id, logId));
    expect(row?.payload).toMatchObject({ executorId: "mod-1" });
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

  test("MemberDisconnectはcount=1の場合のみvoiceのleave行に相関する", async () => {
    const logId = await insertVoiceLogEntry("u1", "c1", "leave", new Date("2026-08-31T00:00:00.000Z"));
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "MemberDisconnect",
      executorId: "mod-1",
      targetId: null,
      createdAt: "2026-08-31T00:00:05.000Z",
      voiceDisconnectOrMove: { count: 1 },
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [row] = await db.select().from(logEntries).where(eq(logEntries.id, logId));
    expect(row?.payload).toMatchObject({ executorId: "mod-1" });
  });

  test("MemberDisconnectはcount!==1の場合は相関しない(複数人同時切断で対象を特定できないため)", async () => {
    const logId = await insertVoiceLogEntry("u1", "c1", "leave", new Date("2026-08-31T00:00:00.000Z"));
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "MemberDisconnect",
      executorId: "mod-1",
      targetId: null,
      createdAt: "2026-08-31T00:00:05.000Z",
      voiceDisconnectOrMove: { count: 2 },
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [row] = await db.select().from(logEntries).where(eq(logEntries.id, logId));
    expect(row?.payload).not.toHaveProperty("executorId");
  });

  test("MemberDisconnectはcount=1でも同時間窓に候補が2件あれば誤相関を避けるためどちらにも相関しない", async () => {
    const logId1 = await insertVoiceLogEntry("u1", "c1", "leave", new Date("2026-08-31T00:00:00.000Z"));
    const logId2 = await insertVoiceLogEntry("u2", "c1", "leave", new Date("2026-08-31T00:00:01.000Z"));
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "MemberDisconnect",
      executorId: "mod-1",
      targetId: null,
      createdAt: "2026-08-31T00:00:05.000Z",
      voiceDisconnectOrMove: { count: 1 },
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [row1] = await db.select().from(logEntries).where(eq(logEntries.id, logId1));
    const [row2] = await db.select().from(logEntries).where(eq(logEntries.id, logId2));
    expect(row1?.payload).not.toHaveProperty("executorId");
    expect(row2?.payload).not.toHaveProperty("executorId");
  });

  test("MemberMoveはcount=1かつ移動先channelIdが一致するvoiceのmove行に相関する", async () => {
    const logId = await insertVoiceLogEntry("u1", "c2", "move", new Date("2026-08-31T00:00:00.000Z"), { previousChannelId: "c1" });
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "MemberMove",
      executorId: "mod-1",
      targetId: null,
      createdAt: "2026-08-31T00:00:05.000Z",
      voiceDisconnectOrMove: { count: 1, moveChannelId: "c2" },
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [row] = await db.select().from(logEntries).where(eq(logEntries.id, logId));
    expect(row?.payload).toMatchObject({ executorId: "mod-1" });
  });

  test("MemberUpdateのmute変更はuserId一致するvoiceのupdate(serverMuteを含むchanges)行に相関する", async () => {
    const logId = await insertVoiceLogEntry("u1", "c1", "update", new Date("2026-08-31T00:00:00.000Z"), {
      changes: { serverMute: { before: false, after: true } },
    });
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "MemberUpdate",
      executorId: "mod-1",
      targetId: "u1",
      createdAt: "2026-08-31T00:00:05.000Z",
      memberUpdateVoiceStateChanges: { mute: true, hasOtherChanges: false },
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [row] = await db.select().from(logEntries).where(eq(logEntries.id, logId));
    expect(row?.payload).toMatchObject({ executorId: "mod-1" });
  });

  test("MemberUpdateのdeaf変更はserverDeafを含むchanges行に相関する", async () => {
    const logId = await insertVoiceLogEntry("u1", "c1", "update", new Date("2026-08-31T00:00:00.000Z"), {
      changes: { serverDeaf: { before: false, after: true } },
    });
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "MemberUpdate",
      executorId: "mod-1",
      targetId: "u1",
      createdAt: "2026-08-31T00:00:05.000Z",
      memberUpdateVoiceStateChanges: { deaf: true, hasOtherChanges: false },
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [row] = await db.select().from(logEntries).where(eq(logEntries.id, logId));
    expect(row?.payload).toMatchObject({ executorId: "mod-1" });
  });

  test("MemberUpdateはuserIdが一致しないvoice update行には相関しない", async () => {
    const logId = await insertVoiceLogEntry("u2", "c1", "update", new Date("2026-08-31T00:00:00.000Z"), {
      changes: { serverMute: { before: false, after: true } },
    });
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "MemberUpdate",
      executorId: "mod-1",
      targetId: "u1",
      createdAt: "2026-08-31T00:00:05.000Z",
      memberUpdateVoiceStateChanges: { mute: true, hasOtherChanges: false },
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [row] = await db.select().from(logEntries).where(eq(logEntries.id, logId));
    expect(row?.payload).not.toHaveProperty("executorId");
  });

  test("MemberUpdateはmute解除(false)の監査ログの場合、逆方向(after:true)のvoice update行には相関しない(誤相関防止)", async () => {
    const logId = await insertVoiceLogEntry("u1", "c1", "update", new Date("2026-08-31T00:00:00.000Z"), {
      changes: { serverMute: { before: false, after: true } },
    });
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "MemberUpdate",
      executorId: "mod-1",
      targetId: "u1",
      createdAt: "2026-08-31T00:00:05.000Z",
      memberUpdateVoiceStateChanges: { mute: false, hasOtherChanges: false },
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [row] = await db.select().from(logEntries).where(eq(logEntries.id, logId));
    expect(row?.payload).not.toHaveProperty("executorId");
  });

  test("MemberUpdateはnicknameChange等mute/deaf以外の変更のみの場合は既存のmemberルールに沿って相関する(voice側は対象外)", async () => {
    const memberLogId = await insertMemberLogEntry("u1", "nicknameChange", new Date("2026-08-31T00:00:00.000Z"));
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "MemberUpdate",
      executorId: "mod-1",
      targetId: "u1",
      createdAt: "2026-08-31T00:00:05.000Z",
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [row] = await db.select().from(logEntries).where(eq(logEntries.id, memberLogId));
    expect(row?.payload).toMatchObject({ executorId: "mod-1" });
  });

  test("MemberUpdateがmuteのみ(hasOtherChanges=false)の場合、同時刻のnicknameChange行には誤相関しない", async () => {
    const memberLogId = await insertMemberLogEntry("u1", "nicknameChange", new Date("2026-08-31T00:00:00.000Z"));
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "MemberUpdate",
      executorId: "mod-1",
      targetId: "u1",
      createdAt: "2026-08-31T00:00:05.000Z",
      memberUpdateVoiceStateChanges: { mute: true, hasOtherChanges: false },
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [row] = await db.select().from(logEntries).where(eq(logEntries.id, memberLogId));
    expect(row?.payload).not.toHaveProperty("executorId");
  });

  test("MemberUpdateがmute+nickname同時変更(hasOtherChanges=true)の場合、voiceとmember両方に相関する", async () => {
    const voiceLogId = await insertVoiceLogEntry("u1", "c1", "update", new Date("2026-08-31T00:00:00.000Z"), {
      changes: { serverMute: { before: false, after: true } },
    });
    const memberLogId = await insertMemberLogEntry("u1", "nicknameChange", new Date("2026-08-31T00:00:00.000Z"));
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "MemberUpdate",
      executorId: "mod-1",
      targetId: "u1",
      createdAt: "2026-08-31T00:00:05.000Z",
      memberUpdateVoiceStateChanges: { mute: true, hasOtherChanges: true },
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [voiceRow] = await db.select().from(logEntries).where(eq(logEntries.id, voiceLogId));
    const [memberRow] = await db.select().from(logEntries).where(eq(logEntries.id, memberLogId));
    expect(voiceRow?.payload).toMatchObject({ executorId: "mod-1" });
    expect(memberRow?.payload).toMatchObject({ executorId: "mod-1" });
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

  test("候補action群のうち、監査ログ時刻に近い方の行にのみ相関する(取り違え防止)", async () => {
    // 同一ユーザーへnicknameChange→timeoutが連続した場合を想定。timeoutの監査ログ(t=10s)は
    // 直近のtimeout行(t=9s)に相関すべきで、より新しいだけの無関係行を選んではいけない。
    const nicknameLogId = await insertMemberLogEntry("u1", "nicknameChange", new Date("2026-08-31T00:00:00.000Z"));
    const timeoutLogId = await insertMemberLogEntry("u1", "timeout", new Date("2026-08-31T00:00:09.000Z"));
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "MemberUpdate",
      executorId: "mod-1",
      targetId: "u1",
      createdAt: "2026-08-31T00:00:10.000Z",
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [nicknameRow] = await db.select().from(logEntries).where(eq(logEntries.id, nicknameLogId));
    const [timeoutRow] = await db.select().from(logEntries).where(eq(logEntries.id, timeoutLogId));
    expect(timeoutRow?.payload).toMatchObject({ executorId: "mod-1" });
    expect(nicknameRow?.payload).not.toMatchObject({ executorId: "mod-1" });
  });

  test("タイムアウト解除(timeoutRemove)にも実行者を相関する", async () => {
    const logId = await insertMemberLogEntry("u1", "timeoutRemove", new Date("2026-08-31T00:00:00.000Z"));
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "MemberUpdate",
      executorId: "mod-1",
      targetId: "u1",
      createdAt: "2026-08-31T00:00:05.000Z",
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, NO_RETRY_DELAY);

    const [row] = await db.select().from(logEntries).where(eq(logEntries.id, logId));
    expect(row?.payload).toMatchObject({ executorId: "mod-1" });
  });

  test("同じチャンネルへの2つの操作の監査ログが並行して届いても、それぞれ別の行に相関する(競合時の取り違え防止)", async () => {
    const firstLogId = await insertChannelLogEntry("c-concurrent", new Date("2026-08-31T00:00:00.000Z"));
    const secondLogId = await insertChannelLogEntry("c-concurrent", new Date("2026-08-31T00:00:01.000Z"));
    const firstEntry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "ChannelDelete",
      executorId: "mod-1",
      targetId: "c-concurrent",
      createdAt: "2026-08-31T00:00:00.100Z",
    };
    const secondEntry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "ChannelDelete",
      executorId: "mod-2",
      targetId: "c-concurrent",
      createdAt: "2026-08-31T00:00:01.100Z",
    };

    await Promise.all([
      correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, firstEntry, NO_RETRY_DELAY),
      correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, secondEntry, NO_RETRY_DELAY),
    ]);

    const [firstRow] = await db.select().from(logEntries).where(eq(logEntries.id, firstLogId));
    const [secondRow] = await db.select().from(logEntries).where(eq(logEntries.id, secondLogId));
    const executorIds = [firstRow?.payload, secondRow?.payload].map(
      (payload) => (payload as { executorId?: string }).executorId,
    );
    // どちらの行にも実行者が付き、同じ実行者が両方の行を奪うことはない(競り負けた側は別候補にリトライする)。
    expect(executorIds).toContain("mod-1");
    expect(executorIds).toContain("mod-2");
  });

  test("MemberRoleUpdateで複数roleIdが遅延挿入されても、イベント全体で1回のリトライにまとまる", async () => {
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "MemberRoleUpdate",
      executorId: "mod-1",
      targetId: "u1",
      createdAt: new Date().toISOString(),
      roleChanges: { added: ["r1", "r2", "r3"], removed: [] },
    };

    const start = Date.now();
    const correlationPromise = correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry, 300);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const logIds = await Promise.all(
      ["r1", "r2", "r3"].map((roleId) => insertRoleLogEntry(roleId, "u1", "memberAdd", new Date())),
    );
    await correlationPromise;
    const elapsedMs = Date.now() - start;

    // 3ロール分を直列に2秒×3待っていたら1000ms以内には終わらない(実際は1回の300ms待機のみ)
    expect(elapsedMs).toBeLessThan(1000);
    for (const logId of logIds) {
      const [row] = await db.select().from(logEntries).where(eq(logEntries.id, logId));
      expect(row?.payload).toMatchObject({ executorId: "mod-1" });
    }
  });
});
