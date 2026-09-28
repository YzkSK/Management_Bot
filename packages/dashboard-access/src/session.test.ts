import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, sessions, type Db } from "@management-bot/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { deleteSession, getSessionAccessToken, purgeExpiredSessions, validateSession } from "./session.ts";
import { encryptToken } from "./token-crypto.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const sessionId = `session-1-${randomUUID()}`;

afterAll(async () => {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
  await close();
});

beforeEach(async () => {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
});

async function insertSession(db: Db, overrides: Partial<typeof sessions.$inferInsert> = {}) {
  await db.insert(sessions).values({
    id: sessionId,
    discordUserId: "user-1",
    discordUsername: "yuzuki_nom1",
    encryptedAccessToken: "test-access-token",
    encryptedRefreshToken: "test-refresh-token",
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  });
}

describe("validateSession", () => {
  test("有効なセッションIDならdiscordUserId・discordUsername・expiresAtを返す", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    await insertSession(db, { expiresAt });

    const result = await validateSession(db, sessionId);

    expect(result).toEqual({ discordUserId: "user-1", discordUsername: "yuzuki_nom1", expiresAt });
  });

  test("存在しないセッションIDはnullを返す", async () => {
    const result = await validateSession(db, "nonexistent");

    expect(result).toBeNull();
  });

  test("期限切れセッションはnullを返す", async () => {
    await insertSession(db, { expiresAt: new Date(Date.now() - 1000) });

    const result = await validateSession(db, sessionId);

    expect(result).toBeNull();
  });
});

describe("deleteSession", () => {
  test("セッション行を削除する", async () => {
    await insertSession(db);

    await deleteSession(db, sessionId);

    expect(await validateSession(db, sessionId)).toBeNull();
  });

  test("存在しないセッションIDでもエラーにならない", async () => {
    await expect(deleteSession(db, "nonexistent")).resolves.toBeUndefined();
  });
});

describe("getSessionAccessToken", () => {
  const sessionSecret = "test-session-secret";

  test("有効なセッションなら復号したアクセストークンを返す", async () => {
    await insertSession(db, { encryptedAccessToken: encryptToken("raw-access-token", sessionSecret) });

    const result = await getSessionAccessToken(db, sessionId, sessionSecret);

    expect(result).toBe("raw-access-token");
  });

  test("存在しないセッションIDはnullを返す", async () => {
    const result = await getSessionAccessToken(db, "nonexistent", sessionSecret);

    expect(result).toBeNull();
  });

  test("期限切れセッションはnullを返す", async () => {
    await insertSession(db, {
      encryptedAccessToken: encryptToken("raw-access-token", sessionSecret),
      expiresAt: new Date(Date.now() - 1000),
    });

    const result = await getSessionAccessToken(db, sessionId, sessionSecret);

    expect(result).toBeNull();
  });
});

describe("purgeExpiredSessions", () => {
  async function exists(id: string): Promise<boolean> {
    const rows = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, id));
    return rows.length > 0;
  }

  test("期限切れのセッション行を削除し、有効なセッションは残す", async () => {
    const validId = `session-valid-${randomUUID()}`;
    await insertSession(db, { expiresAt: new Date(Date.now() - 1000) });
    await db.insert(sessions).values({
      id: validId,
      discordUserId: "user-2",
      discordUsername: "user2",
      encryptedAccessToken: "a",
      encryptedRefreshToken: "r",
      expiresAt: new Date(Date.now() + 60_000),
    });

    try {
      // 他テストと並行実行されると削除件数の合計は変動しうるため、件数は下限だけ確認する。
      const deleted = await purgeExpiredSessions(db);

      expect(deleted).toBeGreaterThanOrEqual(1);
      expect(await exists(sessionId)).toBe(false);
      expect(await exists(validId)).toBe(true);
    } finally {
      await db.delete(sessions).where(eq(sessions.id, validId));
    }
  });

  test("expiresAtがnowちょうどの行も削除対象(境界含む)", async () => {
    // 他テストの有効なセッションを巻き込まないよう、過去の時刻を基準にする。
    const now = new Date(Date.now() - 60 * 60_000);
    await insertSession(db, { expiresAt: now });

    await purgeExpiredSessions(db, now);

    expect(await exists(sessionId)).toBe(false);
  });
});
