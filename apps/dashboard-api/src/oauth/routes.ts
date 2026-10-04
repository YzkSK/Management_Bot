import { createHash, randomBytes } from "node:crypto";
import type { Db } from "@management-bot/db";
import { createSession, deleteSession } from "@management-bot/dashboard-access";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { buildAuthorizeUrl, exchangeCodeForToken, fetchDiscordUser } from "./discord-client.js";
import { signState, verifyState } from "./state.js";

const STATE_COOKIE = "oauth_state";
const PKCE_COOKIE = "oauth_pkce_verifier";
const SESSION_COOKIE = "session_id";

export interface OAuthRoutesConfig {
  db: Db;
  discordClientId: string;
  discordClientSecret: string;
  discordRedirectUri: string;
  sessionSecret: string;
  /** OAuth2完了後のリダイレクト先(ダッシュボードのフロントエンドURL)。 */
  successRedirectUrl: string;
  /** `secure` cookie属性。開発環境(http)ではfalseにする。 */
  secureCookies: boolean;
}

export function createOAuthRoutes(config: OAuthRoutesConfig): Hono {
  const app = new Hono();

  app.get("/login", (c) => {
    const state = signState(config.sessionSecret);
    // PKCE(S256、issue #563)。認可コードの横取り・注入に対する多層防御。
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const cookieOptions = {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: "Lax",
      maxAge: 600,
      path: "/",
    } as const;
    setCookie(c, STATE_COOKIE, state, cookieOptions);
    setCookie(c, PKCE_COOKIE, codeVerifier, cookieOptions);
    return c.redirect(
      buildAuthorizeUrl({
        clientId: config.discordClientId,
        redirectUri: config.discordRedirectUri,
        state,
        codeChallenge,
      }),
    );
  });

  app.get("/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const stateCookie = getCookie(c, STATE_COOKIE);
    const codeVerifier = getCookie(c, PKCE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: "/" });
    deleteCookie(c, PKCE_COOKIE, { path: "/" });

    if (!code || !codeVerifier || !verifyState(state, stateCookie, config.sessionSecret)) {
      return c.text("Invalid OAuth2 state", 400);
    }

    const token = await exchangeCodeForToken({
      code,
      clientId: config.discordClientId,
      clientSecret: config.discordClientSecret,
      redirectUri: config.discordRedirectUri,
      codeVerifier,
    });
    const discordUser = await fetchDiscordUser(token.access_token);

    const sessionId = await createSession(config.db, {
      discordUserId: discordUser.id,
      discordUsername: discordUser.username,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      sessionSecret: config.sessionSecret,
    });

    setCookie(c, SESSION_COOKIE, sessionId, {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: "Lax",
      maxAge: token.expires_in,
      path: "/",
    });

    return c.redirect(config.successRedirectUrl);
  });

  app.post("/logout", async (c) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    if (sessionId) {
      await deleteSession(config.db, sessionId);
    }
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.body(null, 204);
  });

  return app;
}

export { SESSION_COOKIE };
