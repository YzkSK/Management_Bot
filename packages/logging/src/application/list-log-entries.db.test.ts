import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, guilds, logEntries } from "@management-bot/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { LogEntry } from "../domain/index.js";
import { listLogEntries, maskSensitiveFields } from "./list-log-entries.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId = `test-guild-${randomUUID()}`;
const otherGuildId = `test-guild-${randomUUID()}`;

afterAll(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await db.delete(guilds).where(eq(guilds.id, otherGuildId));
  await close();
});

beforeEach(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await db.delete(guilds).where(eq(guilds.id, otherGuildId));
  await db.insert(guilds).values([
    { id: guildId, name: "guild" },
    { id: otherGuildId, name: "other guild" },
  ]);
});

function memberEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    category: "member",
    guildId,
    createdAt: "2026-08-31T00:00:00.000Z",
    userId: "u1",
    action: "join",
    ...overrides,
  } as LogEntry;
}

async function insert(entry: LogEntry, createdAt: string): Promise<void> {
  await db.insert(logEntries).values({
    id: randomUUID(),
    guildId: entry.guildId,
    category: entry.category,
    payload: entry,
    createdAt: new Date(createdAt),
  });
}

describe("listLogEntries", () => {
  test("guildIdで絞り込み、他ギルドのエントリを含まない", async () => {
    await insert(memberEntry(), "2026-08-31T00:00:00.000Z");
    await insert(memberEntry({ guildId: otherGuildId }), "2026-08-31T00:00:01.000Z");

    const result = await listLogEntries(db, { guildId, limit: 50 });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.entry.guildId).toBe(guildId);
  });

  test("categoryで絞り込む", async () => {
    await insert(memberEntry(), "2026-08-31T00:00:00.000Z");
    await insert(
      { category: "guild", guildId, createdAt: "2026-08-31T00:00:01.000Z", action: "update" },
      "2026-08-31T00:00:01.000Z",
    );

    const result = await listLogEntries(db, { guildId, category: "member", limit: 50 });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.entry.category).toBe("member");
  });

  test("createdAt降順で返し、limitと同数返った場合はnextCursorを返す", async () => {
    await insert(memberEntry(), "2026-08-31T00:00:00.000Z");
    await insert(memberEntry({ userId: "u2" }), "2026-08-31T00:00:01.000Z");
    await insert(memberEntry({ userId: "u3" }), "2026-08-31T00:00:02.000Z");

    const result = await listLogEntries(db, { guildId, limit: 2 });

    expect(result.entries.map((e) => (e.entry as { userId: string }).userId)).toEqual([
      "u3",
      "u2",
    ]);
    expect(result.nextCursor).toBe("2026-08-31T00:00:01.000Z");
  });

  test("limit未満しか返らない場合はnextCursorがnull", async () => {
    await insert(memberEntry(), "2026-08-31T00:00:00.000Z");

    const result = await listLogEntries(db, { guildId, limit: 50 });

    expect(result.nextCursor).toBeNull();
  });

  test("cursorより古いエントリのみ返す", async () => {
    await insert(memberEntry({ userId: "u1" }), "2026-08-31T00:00:00.000Z");
    await insert(memberEntry({ userId: "u2" }), "2026-08-31T00:00:01.000Z");

    const result = await listLogEntries(db, {
      guildId,
      limit: 50,
      cursor: "2026-08-31T00:00:01.000Z",
    });

    expect(result.entries).toHaveLength(1);
    expect((result.entries[0]?.entry as { userId: string }).userId).toBe("u1");
  });
});

describe("maskSensitiveFields", () => {
  test("messageカテゴリのcontentを取り除く", () => {
    const entry: LogEntry = {
      category: "message",
      guildId,
      createdAt: "2026-08-31T00:00:00.000Z",
      channelId: "c1",
      authorId: "a1",
      action: "create",
      content: "secret message",
    };

    const masked = maskSensitiveFields(entry);

    expect((masked as { content?: string }).content).toBeUndefined();
  });

  test("message以外のカテゴリはそのまま返す", () => {
    const entry = memberEntry();

    expect(maskSensitiveFields(entry)).toEqual(entry);
  });
});
