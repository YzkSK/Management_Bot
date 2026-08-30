import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, guilds, sessions, type Db } from "@management-bot/db";
import { validateSession } from "./session.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await db.delete(sessions);
  await db.delete(guilds);
});

async function insertSession(db: Db, overrides: Partial<typeof sessions.$inferInsert> = {}) {
  await db.insert(sessions).values({
    id: "session-1",
    discordUserId: "user-1",
    encryptedAccessToken: "test-access-token",
    encryptedRefreshToken: "test-refresh-token",
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  });
}

describe("validateSession", () => {
  test("有効なセッションIDならdiscordUserIdを返す", async () => {
    await insertSession(db);

    const result = await validateSession(db, "session-1");

    expect(result).toEqual({ discordUserId: "user-1" });
  });

  test("存在しないセッションIDはnullを返す", async () => {
    const result = await validateSession(db, "nonexistent");

    expect(result).toBeNull();
  });

  test("期限切れセッションはnullを返す", async () => {
    await insertSession(db, { expiresAt: new Date(Date.now() - 1000) });

    const result = await validateSession(db, "session-1");

    expect(result).toBeNull();
  });
});
