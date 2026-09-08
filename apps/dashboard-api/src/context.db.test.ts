import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { createDb, sessions } from "@management-bot/db";
import { encryptToken } from "@management-bot/dashboard-access";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DiscordAccessForbiddenError } from "./discord/bot-client.ts";
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
    discordUsername: "user-1-name",
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

/**
 * `/users/@me/guilds`(ユーザーOAuth)は固定のguild一覧を返し、
 * `/guilds/{id}/members/{userId}`(Botトークン)は固定のroles配列を返す。
 * resolveGuildMembershipは両方を呼ぶため、URLで振り分ける。
 */
function mockUserGuildsAndMemberRolesFetch(guilds: unknown[], roles: string[]): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/users/@me/guilds")) {
      return new Response(JSON.stringify(guilds), { status: 200 });
    }
    if (url.includes("/members/")) {
      return new Response(JSON.stringify({ roles }), { status: 200 });
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;
}

/** member APIのstatusを差し替えられる版。404/403時のresolveGuildMembership挙動を検証する。 */
function mockUserGuildsFetchWithMemberStatus(guilds: unknown[], memberStatus: number): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/users/@me/guilds")) {
      return new Response(JSON.stringify(guilds), { status: 200 });
    }
    if (url.includes("/members/")) {
      return new Response(undefined, { status: memberStatus });
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;
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
    mockUserGuildsAndMemberRolesFetch([{ id: guildId, name: "g", owner: true, permissions: "0" }], ["r1"]);

    const first = await resolveGuildMembership(db, sessionId, sessionSecret, "test-bot-token", guildId, "user-1");
    const second = await resolveGuildMembership(db, sessionId, sessionSecret, "test-bot-token", guildId, "user-1");

    expect(first).toEqual({ isOwner: true, roleIds: [guildId, "r1"] });
    expect(second).toEqual({ isOwner: true, roleIds: [guildId, "r1"] });
  });

  test("在籍していないguildに対してはnullを返す(Botトークンへの問い合わせは行わない)", async () => {
    const sessionId = `session-${randomUUID()}`;
    await insertSession(sessionId);
    mockUserGuildsFetch([{ id: "other-guild", name: "g", owner: true, permissions: "0" }]);

    const result = await resolveGuildMembership(
      db,
      sessionId,
      sessionSecret,
      "test-bot-token",
      `guild-${randomUUID()}`,
      "user-1",
    );

    expect(result).toBeNull();
  });

  test("OAuth上は在籍していてもBot member APIが404(実際は非在籍)ならnullを返す", async () => {
    const sessionId = `session-${randomUUID()}`;
    await insertSession(sessionId);
    const guildId = `guild-${randomUUID()}`;
    mockUserGuildsFetchWithMemberStatus([{ id: guildId, name: "g", owner: true, permissions: "0" }], 404);

    const result = await resolveGuildMembership(db, sessionId, sessionSecret, "test-bot-token", guildId, "user-1");

    expect(result).toBeNull();
  });

  test("Bot member APIが403(Bot脱退・権限異常等)なら、ロールなしにfail-openせず例外を投げる", async () => {
    const sessionId = `session-${randomUUID()}`;
    await insertSession(sessionId);
    const guildId = `guild-${randomUUID()}`;
    mockUserGuildsFetchWithMemberStatus([{ id: guildId, name: "g", owner: true, permissions: "0" }], 403);

    // expect(promise).rejects.toBeInstanceOf()はbun:testがハングする既知の相性問題があるため、
    // try/catchで代替する(packages/logging/src/router/index.test.tsと同様)。
    let error: unknown;
    try {
      await resolveGuildMembership(db, sessionId, sessionSecret, "test-bot-token", guildId, "user-1");
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(DiscordAccessForbiddenError);
  });
});
