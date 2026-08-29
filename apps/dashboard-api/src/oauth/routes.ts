import type { Db } from "@management-bot/db";
import { createSession } from "@management-bot/dashboard-access";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { buildAuthorizeUrl, exchangeCodeForToken, fetchDiscordUserId } from "./discord-client.js";
import { signState, verifyState } from "./state.js";

const STATE_COOKIE = "oauth_state";
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
    setCookie(c, STATE_COOKIE, state, {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: "Lax",
      maxAge: 600,
      path: "/",
    });
    return c.redirect(
      buildAuthorizeUrl({
        clientId: config.discordClientId,
        redirectUri: config.discordRedirectUri,
        state,
      }),
    );
  });

  app.get("/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const stateCookie = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: "/" });

    if (!code || !verifyState(state, stateCookie, config.sessionSecret)) {
      return c.text("Invalid OAuth2 state", 400);
    }

    const token = await exchangeCodeForToken({
      code,
      clientId: config.discordClientId,
      clientSecret: config.discordClientSecret,
      redirectUri: config.discordRedirectUri,
    });
    const discordUserId = await fetchDiscordUserId(token.access_token);

    const sessionId = await createSession(config.db, {
      discordUserId,
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

  return app;
}

export { SESSION_COOKIE };
