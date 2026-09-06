import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { createDb, sessions } from "@management-bot/db";
import { encryptToken } from "@management-bot/dashboard-access";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { fetchCurrentUserGuilds, resolveGuildMembership } from "./context.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const sessionSecret = "test-session-secret";
const originalFetch = globalThis.fetch;

afterAll(async () => {
  await close();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function insertSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
  await db.insert(sessions).values({
    id: sessionId,
    discordUserId: "user-1",
    encryptedAccessToken: encryptToken("test-access-token", sessionSecret),
    encryptedRefreshToken: encryptToken("test-refresh-token", sessionSecret),
    expiresAt: new Date(Date.now() + 60_000),
  });
}

function mockUserGuildsFetch(guilds: unknown[]): { calls: number } {
  const state = { calls: 0 };
  globalThis.fetch = (async () => {
    state.calls++;
    return new Response(JSON.stringify(guilds), { status: 200 });
  }) as typeof fetch;
  return state;
}

describe("fetchCurrentUserGuilds", () => {
  test("同一セッションIDへの同時呼び出しはDiscord APIを1回しか叩かない(リクエスト内重複排除)", async () => {
    const sessionId = `session-${randomUUID()}`;
    await insertSession(sessionId);
    const fetchState = mockUserGuildsFetch([{ id: "g1", name: "g1", owner: true, permissions: "0" }]);

    const [a, b, c] = await Promise.all([
      fetchCurrentUserGuilds(db, sessionId, sessionSecret),
      fetchCurrentUserGuilds(db, sessionId, sessionSecret),
      fetchCurrentUserGuilds(db, sessionId, sessionSecret),
    ]);

    expect(fetchState.calls).toBe(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  test("異なるセッションIDはそれぞれ独立にfetchする", async () => {
    const sessionId1 = `session-${randomUUID()}`;
    const sessionId2 = `session-${randomUUID()}`;
    await insertSession(sessionId1);
    await insertSession(sessionId2);
    const fetchState = mockUserGuildsFetch([{ id: "g1", name: "g1", owner: true, permissions: "0" }]);

    await fetchCurrentUserGuilds(db, sessionId1, sessionSecret);
    await fetchCurrentUserGuilds(db, sessionId2, sessionSecret);

    expect(fetchState.calls).toBe(2);
  });
});

describe("resolveGuildMembership (RBAC結果の不変性)", () => {
  test("複数回呼んでもmembership判定結果は変わらない(キャッシュ導入前と同じ結果)", async () => {
    const sessionId = `session-${randomUUID()}`;
    await insertSession(sessionId);
    const guildId = `guild-${randomUUID()}`;
    mockUserGuildsFetch([{ id: guildId, name: "g", owner: true, permissions: "0" }]);

    const first = await resolveGuildMembership(db, sessionId, sessionSecret, guildId);
    const second = await resolveGuildMembership(db, sessionId, sessionSecret, guildId);

    expect(first).toEqual({ isOwner: true, roleIds: [guildId] });
    expect(second).toEqual({ isOwner: true, roleIds: [guildId] });
  });

  test("在籍していないguildに対してはnullを返す", async () => {
    const sessionId = `session-${randomUUID()}`;
    await insertSession(sessionId);
    mockUserGuildsFetch([{ id: "other-guild", name: "g", owner: true, permissions: "0" }]);

    const result = await resolveGuildMembership(db, sessionId, sessionSecret, `guild-${randomUUID()}`);

    expect(result).toBeNull();
  });
});
