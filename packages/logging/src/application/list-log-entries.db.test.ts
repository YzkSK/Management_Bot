import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, guilds, logEntries } from "@management-bot/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { LogEntry } from "../domain/index.js";
import { decodeCursor, encodeCursor, listLogEntries, maskSensitiveFields } from "./list-log-entries.js";

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

async function insert(entry: LogEntry, createdAt: string, authorIsBot = false): Promise<void> {
  await db.insert(logEntries).values({
    id: randomUUID(),
    guildId: entry.guildId,
    category: entry.category,
    authorIsBot,
    payload: entry,
    createdAt: new Date(createdAt),
  });
}

function messageCreateEntry(messageId: string, content: string): LogEntry {
  return {
    category: "message",
    guildId,
    createdAt: "2026-09-20T00:00:00.000Z",
    channelId: "c1",
    authorId: "u1",
    messageId,
    action: "create",
    content,
  };
}

function bulkDeleteEntry(messageIds: readonly string[], moderationCaseId?: string): LogEntry {
  return {
    category: "message",
    guildId,
    createdAt: "2026-09-20T00:01:00.000Z",
    channelId: "c1",
    action: "bulkDelete",
    ...(moderationCaseId ? { moderationCaseId } : {}),
    deletedMessages: messageIds.map((messageId) => ({ messageId, authorId: "u1" })),
  };
}

function moderationCaseEntry(caseId: string): LogEntry {
  return {
    category: "moderationCase",
    guildId,
    createdAt: "2026-09-20T00:02:00.000Z",
    caseId,
    targetUserId: "u1",
    moderatorId: "system",
    action: "resolve",
    actionType: "warn",
    result: "success",
  };
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

  test("一括削除に含まれる15件の投稿ログを子ログへ集約し、次ページで重複表示しない", async () => {
    const messageIds = Array.from({ length: 15 }, (_, index) => `message-${index + 1}`);
    for (const [index, messageId] of messageIds.entries()) {
      await insert(messageCreateEntry(messageId, `content-${index + 1}`), `2026-09-20T00:00:${String(index).padStart(2, "0")}.000Z`);
    }
    await insert(memberEntry({ userId: "unrelated" }), "2026-09-20T00:00:30.000Z");
    await insert(bulkDeleteEntry(messageIds), "2026-09-20T00:01:00.000Z");

    const firstPage = await listLogEntries(db, { guildId, limit: 1 });

    expect(firstPage.entries).toHaveLength(1);
    expect(firstPage.entries[0]).toMatchObject({
      entry: { action: "bulkDelete" },
      collapsedEntries: messageIds.map((messageId, index) => ({
        entry: { action: "create", messageId, content: `content-${index + 1}` },
      })),
    });
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await listLogEntries(db, { guildId, limit: 50, cursor: firstPage.nextCursor! });

    expect(secondPage.entries.map(({ entry }) => entry)).toEqual([expect.objectContaining({ userId: "unrelated" })]);
  });

  test("モデレーションケースに関連付く一括削除と投稿ログを再帰的に集約する", async () => {
    await insert(messageCreateEntry("message-1", "content-1"), "2026-09-20T00:00:00.000Z");
    await insert(messageCreateEntry("message-2", "content-2"), "2026-09-20T00:00:01.000Z");
    await insert(bulkDeleteEntry(["message-1", "message-2"], "case-1"), "2026-09-20T00:01:00.000Z");
    await insert(moderationCaseEntry("case-1"), "2026-09-20T00:02:00.000Z");

    const result = await listLogEntries(db, { guildId, limit: 50 });

    expect(result.entries).toMatchObject([
      {
        entry: { category: "moderationCase", caseId: "case-1" },
        collapsedEntries: [
          {
            entry: { action: "bulkDelete", moderationCaseId: "case-1" },
            collapsedEntries: [
              { entry: { action: "create", messageId: "message-1", content: "content-1" } },
              { entry: { action: "create", messageId: "message-2", content: "content-2" } },
            ],
          },
        ],
      },
    ]);
  });

  test("messageIdを持たない既存の投稿ログは一括削除の子ログにせず通常表示する", async () => {
    await insert(
      {
        category: "message",
        guildId,
        createdAt: "2026-09-20T00:00:00.000Z",
        channelId: "c1",
        authorId: "u1",
        action: "create",
        content: "legacy",
      },
      "2026-09-20T00:00:00.000Z",
    );
    await insert(bulkDeleteEntry(["message-1"]), "2026-09-20T00:01:00.000Z");

    const result = await listLogEntries(db, { guildId, limit: 50 });

    expect(result.entries.map(({ entry }) => entry)).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "create", content: "legacy" })]),
    );
  });

  test("excludeCategoriesで指定したカテゴリは結果に含まれない", async () => {
    await insert(memberEntry(), "2026-08-31T00:00:00.000Z");
    await insert(
      {
        category: "auditLogCorrelation",
        guildId,
        createdAt: "2026-08-31T00:00:01.000Z",
        auditLogEntryId: "audit-1",
        actionType: "MEMBER_KICK",
      },
      "2026-08-31T00:00:01.000Z",
    );

    const result = await listLogEntries(db, {
      guildId,
      limit: 50,
      excludeCategories: ["auditLogCorrelation"],
    });

    expect(result.entries.every((e) => e.entry.category !== "auditLogCorrelation")).toBe(true);
  });

  test("excludeBotEventsを指定するとauthorIsBot=trueの行は結果に含まれない", async () => {
    await insert(memberEntry({ userId: "human" }), "2026-08-31T00:00:00.000Z", false);
    await insert(memberEntry({ userId: "bot" }), "2026-08-31T00:00:01.000Z", true);

    const result = await listLogEntries(db, { guildId, limit: 50, excludeBotEvents: true });

    expect(result.entries.map((e) => (e.entry as { userId: string }).userId)).toEqual(["human"]);
  });

  test("createdAt降順で返し、まだ後続がある場合のみnextCursorを返す", async () => {
    await insert(memberEntry(), "2026-08-31T00:00:00.000Z");
    await insert(memberEntry({ userId: "u2" }), "2026-08-31T00:00:01.000Z");
    await insert(memberEntry({ userId: "u3" }), "2026-08-31T00:00:02.000Z");

    const result = await listLogEntries(db, { guildId, limit: 2 });

    expect(result.entries.map((e) => (e.entry as { userId: string }).userId)).toEqual([
      "u3",
      "u2",
    ]);
    expect(result.nextCursor).not.toBeNull();
    expect(decodeCursor(result.nextCursor!).createdAt).toBe("2026-08-31T00:00:01.000Z");
  });

  test("残件がちょうどlimit件でも、それ以上残っていなければnextCursorはnull", async () => {
    await insert(memberEntry(), "2026-08-31T00:00:00.000Z");
    await insert(memberEntry({ userId: "u2" }), "2026-08-31T00:00:01.000Z");

    const result = await listLogEntries(db, { guildId, limit: 2 });

    expect(result.entries).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
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
      cursor: encodeCursor({
        createdAt: "2026-08-31T00:00:01.000Z",
        id: "00000000-0000-0000-0000-000000000000",
      }),
    });

    expect(result.entries).toHaveLength(1);
    expect((result.entries[0]?.entry as { userId: string }).userId).toBe("u1");
  });

  test("同一createdAtのエントリはidの降順で欠落・重複なく分割される", async () => {
    await insert(memberEntry({ userId: "u1" }), "2026-08-31T00:00:00.000Z");
    await insert(memberEntry({ userId: "u2" }), "2026-08-31T00:00:00.000Z");
    await insert(memberEntry({ userId: "u3" }), "2026-08-31T00:00:00.000Z");

    const page1 = await listLogEntries(db, { guildId, limit: 2 });
    expect(page1.entries).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listLogEntries(db, { guildId, limit: 2, cursor: page1.nextCursor! });
    expect(page2.entries).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();

    const seenIds = [...page1.entries, ...page2.entries].map((e) => e.id);
    expect(new Set(seenIds).size).toBe(3);
  });
});

describe("maskSensitiveFields", () => {
  test("messageカテゴリのcontentを残す", () => {
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

    expect((masked as { content?: string }).content).toBe("secret message");
  });

  test("messageカテゴリのpreviousContent(編集前本文)も取り除く(issue #207)", () => {
    const entry: LogEntry = {
      category: "message",
      guildId,
      createdAt: "2026-08-31T00:00:00.000Z",
      channelId: "c1",
      authorId: "a1",
      action: "update",
      content: "new message",
      previousContent: "secret previous message",
    };

    const masked = maskSensitiveFields(entry);

    expect((masked as { content?: string }).content).toBe("new message");
    expect((masked as { previousContent?: string }).previousContent).toBeUndefined();
  });

  test("threadカテゴリのcontent(スターターメッセージ本文)を残す", () => {
    const entry: LogEntry = {
      category: "thread",
      guildId,
      createdAt: "2026-08-31T00:00:00.000Z",
      threadId: "t1",
      channelId: "c1",
      action: "create",
      content: "secret starter message",
    };

    const masked = maskSensitiveFields(entry);

    expect((masked as { content?: string }).content).toBe("secret starter message");
  });

  test("channelカテゴリのchanges(topic等の変更前後)も取り除く", () => {
    const entry: LogEntry = {
      category: "channel",
      guildId,
      createdAt: "2026-08-31T00:00:00.000Z",
      channelId: "c1",
      action: "update",
      changes: { topic: { before: "secret before", after: "secret after" } },
    };

    const masked = maskSensitiveFields(entry);

    expect((masked as { changes?: unknown }).changes).toBeUndefined();
  });

  test("guildカテゴリのchangesも取り除く", () => {
    const entry: LogEntry = {
      category: "guild",
      guildId,
      createdAt: "2026-08-31T00:00:00.000Z",
      action: "update",
      changes: { name: { before: "secret before", after: "secret after" } },
    };

    const masked = maskSensitiveFields(entry);

    expect((masked as { changes?: unknown }).changes).toBeUndefined();
  });

  test("roleカテゴリのchangesも取り除く", () => {
    const entry: LogEntry = {
      category: "role",
      guildId,
      createdAt: "2026-08-31T00:00:00.000Z",
      roleId: "r1",
      action: "update",
      changes: { name: { before: "secret before", after: "secret after" } },
    };

    const masked = maskSensitiveFields(entry);

    expect((masked as { changes?: unknown }).changes).toBeUndefined();
  });

  test("voiceカテゴリのchanges(フラグのon/off)は機微性が低いため取り除かない", () => {
    const entry: LogEntry = {
      category: "voice",
      guildId,
      createdAt: "2026-08-31T00:00:00.000Z",
      userId: "u1",
      channelId: "c1",
      action: "update",
      changes: { selfMute: { before: false, after: true } },
    };

    expect(maskSensitiveFields(entry)).toEqual(entry);
  });

  test("message/thread/channel/guild/role以外のカテゴリはそのまま返す", () => {
    const entry = memberEntry();

    expect(maskSensitiveFields(entry)).toEqual(entry);
  });
});
