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

afterAll(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await close();
});

beforeEach(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await db.insert(guilds).values({ id: guildId, name: "test guild" });
});

async function insertChannelLogEntry(channelId: string, createdAt: Date): Promise<string> {
  const id = randomUUID();
  await db.insert(logEntries).values({
    id,
    guildId,
    category: "channel",
    payload: { category: "channel", guildId, createdAt: createdAt.toISOString(), channelId, action: "delete" },
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

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry);

    const [row] = await db.select().from(logEntries).where(eq(logEntries.id, logId));
    expect(row?.payload).toMatchObject({ executorId: "mod-1" });
  });

  test("時間窓(30秒)を超えた古いログ行には追記しない", async () => {
    const logId = await insertChannelLogEntry("c1", new Date("2026-08-31T00:00:00.000Z"));
    const entry: AuditLogEntryInfo = {
      id: randomUUID(),
      guildId,
      action: "ChannelDelete",
      executorId: "mod-1",
      targetId: "c1",
      createdAt: "2026-08-31T00:05:00.000Z",
    };

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry);

    const [row] = await db.select().from(logEntries).where(eq(logEntries.id, logId));
    expect(row?.payload).not.toMatchObject({ executorId: "mod-1" });
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

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry);

    const [row] = await db
      .select()
      .from(logEntries)
      .where(eq(logEntries.category, "auditLogCorrelation"));
    expect(row?.payload).toMatchObject({ auditLogEntryId: entry.id, actionType: "ChannelDelete" });
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

    await correlateAuditLogEntry({ db, sendToChannel: noopSendToChannel }, entry);

    const [row] = await db.select().from(logEntries).where(eq(logEntries.category, "integration"));
    expect(row?.payload).toMatchObject({ integrationId: "integration-1", action: "create", executorId: "mod-1" });
  });
});
