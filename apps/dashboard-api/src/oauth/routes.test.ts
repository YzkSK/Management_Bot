import { createHash } from "node:crypto";
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Db } from "@management-bot/db";

let mockDeleteSession: (sessionId: string) => Promise<void> = async () => {};

mock.module("@management-bot/dashboard-access", () => ({
  createSession: async () => "new-session-id",
  deleteSession: (_db: Db, sessionId: string) => mockDeleteSession(sessionId),
}));

const { createOAuthRoutes } = await import("./routes.js");
const { signState } = await import("./state.js");

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

  test("PKCE: verifierをCookieに保存し、そのS256 challengeを認可URLに付ける", async () => {
    const app = createOAuthRoutes(baseConfig);
    const res = await app.request("/login");

    const verifier = /oauth_pkce_verifier=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
    expect(verifier).toBeDefined();
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).toBe(
      createHash("sha256")
        .update(verifier ?? "")
        .digest("base64url"),
    );
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

  test("PKCE: verifierのCookieが無ければDiscordを呼ばずに拒否する", async () => {
    let fetchCalled = false;
    global.fetch = (() => {
      fetchCalled = true;
      throw new Error("fetch should not be called");
    }) as typeof fetch;
    const state = signState(baseConfig.sessionSecret);

    const app = createOAuthRoutes(baseConfig);
    const res = await app.request(`/callback?code=abc&state=${encodeURIComponent(state)}`, {
      headers: { cookie: `oauth_state=${state}` },
    });

    expect(res.status).toBe(400);
    expect(fetchCalled).toBe(false);
  });

  test("PKCE: トークン交換でCookieのverifierを送る", async () => {
    let tokenBody: URLSearchParams | undefined;
    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/oauth2/token")) {
        tokenBody = new URLSearchParams(String(init?.body));
        return Response.json({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
      }
      return Response.json({ id: "1", username: "user", avatar: null });
    }) as typeof fetch;
    const state = signState(baseConfig.sessionSecret);

    const app = createOAuthRoutes(baseConfig);
    const res = await app.request(`/callback?code=abc&state=${encodeURIComponent(state)}`, {
      headers: { cookie: `oauth_state=${state}; oauth_pkce_verifier=my-verifier` },
    });

    expect(res.status).toBe(302);
    expect(tokenBody?.get("code_verifier")).toBe("my-verifier");
  });

  test("rejects when the state cookie is missing", async () => {
    const app = createOAuthRoutes(baseConfig);
    const res = await app.request("/callback?code=abc&state=whatever");

    expect(res.status).toBe(400);
  });
});

describe("POST /logout", () => {
  test("clears the session cookie and deletes the session row", async () => {
    let deletedSessionId: string | undefined;
    mockDeleteSession = async (sessionId) => {
      deletedSessionId = sessionId;
    };

    const app = createOAuthRoutes(baseConfig);
    const res = await app.request("/logout", {
      method: "POST",
      headers: { cookie: "session_id=session-abc" },
    });

    expect(res.status).toBe(204);
    expect(deletedSessionId).toBe("session-abc");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("session_id=;");
  });

  test("succeeds even without an existing session cookie", async () => {
    let deleteCalled = false;
    mockDeleteSession = async () => {
      deleteCalled = true;
    };

    const app = createOAuthRoutes(baseConfig);
    const res = await app.request("/logout", { method: "POST" });

    expect(deleteCalled).toBe(false);

    expect(res.status).toBe(204);
  });
});
