import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, guilds, logEntries } from "@management-bot/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { LogEntry } from "../domain/index.js";
import { getMemberJoinFlags } from "./get-member-join-flags.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId = `test-guild-${randomUUID()}`;
const userId = "u1";

afterAll(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await close();
});

beforeEach(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await db.insert(guilds).values({ id: guildId, name: "test guild" });
});

async function insertLogEntry(payload: LogEntry): Promise<void> {
  await db.insert(logEntries).values({
    id: randomUUID(),
    guildId,
    category: payload.category,
    payload,
    createdAt: new Date(payload.createdAt),
  });
}

describe("getMemberJoinFlags (実DB)", () => {
  test("過去ログが何もなければ両方false", async () => {
    const flags = await getMemberJoinFlags(db, guildId, userId);
    expect(flags).toEqual({ isRejoin: false, hasModerationHistory: false });
  });

  test("過去にmember/leaveのログがあればisRejoin=true", async () => {
    await insertLogEntry({
      category: "member",
      guildId,
      createdAt: "2026-08-31T00:00:00.000Z",
      userId,
      action: "leave",
    });

    const flags = await getMemberJoinFlags(db, guildId, userId);
    expect(flags.isRejoin).toBe(true);
  });

  test("過去にmember/joinのログがあればisRejoin=true", async () => {
    await insertLogEntry({
      category: "member",
      guildId,
      createdAt: "2026-08-31T00:00:00.000Z",
      userId,
      action: "join",
    });

    const flags = await getMemberJoinFlags(db, guildId, userId);
    expect(flags.isRejoin).toBe(true);
  });

  test("別ユーザーのmemberログはisRejoinに影響しない", async () => {
    await insertLogEntry({
      category: "member",
      guildId,
      createdAt: "2026-08-31T00:00:00.000Z",
      userId: "other-user",
      action: "leave",
    });

    const flags = await getMemberJoinFlags(db, guildId, userId);
    expect(flags.isRejoin).toBe(false);
  });

  test("moderationCase/banの過去ログがあればhasModerationHistory=true", async () => {
    await insertLogEntry({
      category: "moderationCase",
      guildId,
      createdAt: "2026-08-31T00:00:00.000Z",
      caseId: "case-1",
      targetUserId: userId,
      moderatorId: "mod-1",
      action: "create",
      actionType: "ban",
    });

    const flags = await getMemberJoinFlags(db, guildId, userId);
    expect(flags.hasModerationHistory).toBe(true);
  });

  test("moderationCase/kickの過去ログがあればhasModerationHistory=true", async () => {
    await insertLogEntry({
      category: "moderationCase",
      guildId,
      createdAt: "2026-08-31T00:00:00.000Z",
      caseId: "case-1",
      targetUserId: userId,
      moderatorId: "mod-1",
      action: "create",
      actionType: "kick",
    });

    const flags = await getMemberJoinFlags(db, guildId, userId);
    expect(flags.hasModerationHistory).toBe(true);
  });

  test("moderationCase/warnのみではhasModerationHistory=falseのまま", async () => {
    await insertLogEntry({
      category: "moderationCase",
      guildId,
      createdAt: "2026-08-31T00:00:00.000Z",
      caseId: "case-1",
      targetUserId: userId,
      moderatorId: "mod-1",
      action: "create",
      actionType: "warn",
    });

    const flags = await getMemberJoinFlags(db, guildId, userId);
    expect(flags.hasModerationHistory).toBe(false);
  });
});
