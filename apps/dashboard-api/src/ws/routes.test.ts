import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, guilds, sessions } from "@management-bot/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createLogWsRoutes } from "./routes.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId = `test-guild-${randomUUID()}`;
const sessionSecret = "test-session-secret";
const dashboardWebUrl = "http://localhost:5173";

const { app } = createLogWsRoutes(db, sessionSecret, dashboardWebUrl);

afterAll(async () => {
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

describe("createLogWsRoutes /logs/:guildId (upgrade前の認可)", () => {
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
