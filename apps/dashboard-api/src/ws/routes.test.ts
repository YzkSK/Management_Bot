import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
// oauth/routes.test.tsのmock.moduleがcreateSession自体を(ファイルをまたいで)差し替えるため、
// セッション行は実体のencryptTokenで直接作る。
import { encryptToken } from "@management-bot/dashboard-access/dist/token-crypto.js";
import { createDb, guilds, sessions } from "@management-bot/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createWsRoutes } from "./routes.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId = `test-guild-${randomUUID()}`;
const sessionSecret = "test-session-secret";
const dashboardWebUrl = "http://localhost:5173";

const { app } = createWsRoutes(db, sessionSecret, "test-bot-token", dashboardWebUrl);

afterAll(async () => {
  await db.delete(sessions).where(eq(sessions.discordUsername, "ws-test-user"));
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await close();
});

beforeEach(async () => {
  await db.delete(sessions).where(eq(sessions.id, "session-1"));
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await db.insert(guilds).values({ id: guildId, name: "guild" });
});

function requestWith(headers: Record<string, string>): Promise<Response> {
  return app.request(`/logs/${guildId}`, { headers: { Origin: dashboardWebUrl, ...headers } });
}

describe("createWsRoutes /logs/:guildId (upgrade前の認可)", () => {
  test("Originが一致しなければ403", async () => {
    const res = await app.request(`/logs/${guildId}`, { headers: { Origin: "https://evil.example.com" } });
    expect(res.status).toBe(403);
  });

  test("Originヘッダーが無ければ403", async () => {
    const res = await app.request(`/logs/${guildId}`);
    expect(res.status).toBe(403);
  });

  test("セッションCookieが無ければ401", async () => {
    const res = await requestWith({});
    expect(res.status).toBe(401);
  });

  test("存在しないセッションIDなら401", async () => {
    const res = await requestWith({ Cookie: "session_id=nonexistent" });
    expect(res.status).toBe(401);
  });
});

describe("createWsRoutes /guild/:guildId (在籍のみで接続可)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  async function sessionCookie(): Promise<string> {
    const sessionId = randomUUID();
    await db.insert(sessions).values({
      id: sessionId,
      // 在籍判定は(guild, user)単位でキャッシュされるため、テストごとに別ユーザーにする。
      discordUserId: `ws-test-user-${randomUUID()}`,
      discordUsername: "ws-test-user",
      encryptedAccessToken: encryptToken("access", sessionSecret),
      encryptedRefreshToken: encryptToken("refresh", sessionSecret),
      expiresAt: new Date(Date.now() + 60_000),
    });
    return `session_id=${sessionId}`;
  }

  function mockDiscord(userGuildIds: string[]): void {
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.endsWith("/users/@me/guilds")) {
        return Response.json(userGuildIds.map((id) => ({ id, name: "g", owner: false, permissions: "0" })));
      }
      return Response.json({ roles: [] });
    }) as typeof fetch;
  }

  const guildRequest = (cookie: string) =>
    app.request(`/guild/${guildId}`, { headers: { Origin: dashboardWebUrl, Cookie: cookie } });

  test("Originが一致しなければ403", async () => {
    const res = await app.request(`/guild/${guildId}`, { headers: { Origin: "https://evil.example.com" } });
    expect(res.status).toBe(403);
  });

  test("セッションCookieが無ければ401", async () => {
    const res = await app.request(`/guild/${guildId}`, { headers: { Origin: dashboardWebUrl } });
    expect(res.status).toBe(401);
  });

  test("guildに在籍していなければ403", async () => {
    mockDiscord([]);
    const res = await guildRequest(await sessionCookie());
    expect(res.status).toBe(403);
  });

  test("在籍していればcapability不要で認可を通る(403/401にならない)", async () => {
    mockDiscord([guildId]);
    const res = await guildRequest(await sessionCookie());
    expect([401, 403]).not.toContain(res.status);
  });
});

describe("createWsRoutes /activity/:guildId (upgrade前の認可)", () => {
  test("Originが一致しなければ403", async () => {
    const res = await app.request(`/activity/${guildId}`, { headers: { Origin: "https://evil.example.com" } });
    expect(res.status).toBe(403);
  });

  test("セッションCookieが無ければ401", async () => {
    const res = await app.request(`/activity/${guildId}`, { headers: { Origin: dashboardWebUrl } });
    expect(res.status).toBe(401);
  });
});
