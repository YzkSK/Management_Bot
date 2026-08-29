import { afterEach, describe, expect, test } from "bun:test";
import type { Db } from "@management-bot/db";
import { createOAuthRoutes } from "./routes.js";

const baseConfig = {
  db: {} as Db,
  discordClientId: "client-id",
  discordClientSecret: "client-secret",
  discordRedirectUri: "http://localhost:8787/auth/callback",
  sessionSecret: "a".repeat(32),
  successRedirectUrl: "http://localhost:5173",
  secureCookies: false,
};

describe("GET /login", () => {
  test("issues an HttpOnly, SameSite=Lax state cookie and redirects to Discord", async () => {
    const app = createOAuthRoutes(baseConfig);
    const res = await app.request("/login");

    expect(res.status).toBe(302);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("oauth_state=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(res.headers.get("location")).toContain("discord.com/api/v10/oauth2/authorize");
  });
});

describe("GET /callback", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("rejects mismatched state without calling Discord or the DB", async () => {
    let fetchCalled = false;
    global.fetch = (() => {
      fetchCalled = true;
      throw new Error("fetch should not be called");
    }) as typeof fetch;

    const app = createOAuthRoutes(baseConfig);
    const res = await app.request("/callback?code=abc&state=tampered", {
      headers: { cookie: "oauth_state=legit.signature" },
    });

    expect(res.status).toBe(400);
    expect(fetchCalled).toBe(false);
  });

  test("rejects when the state cookie is missing", async () => {
    const app = createOAuthRoutes(baseConfig);
    const res = await app.request("/callback?code=abc&state=whatever");

    expect(res.status).toBe(400);
  });
});
