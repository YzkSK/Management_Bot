import { randomUUID } from "node:crypto";
import { sessions, type Db } from "@management-bot/db";
import { and, eq, gt } from "drizzle-orm";
import { decryptToken, encryptToken } from "./token-crypto.js";

export interface ValidatedSession {
  discordUserId: string;
  expiresAt: Date;
}

export async function validateSession(
  db: Db,
  sessionId: string,
): Promise<ValidatedSession | null> {
  const [row] = await db
    .select({ discordUserId: sessions.discordUserId, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return row ?? null;
}

/** セッションに紐づくDiscordのOAuth2アクセストークンを復号して返す。Discord API(ユーザー権限)呼び出し用。 */
export async function getSessionAccessToken(
  db: Db,
  sessionId: string,
  sessionSecret: string,
): Promise<string | null> {
  const [row] = await db
    .select({ encryptedAccessToken: sessions.encryptedAccessToken })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return row ? decryptToken(row.encryptedAccessToken, sessionSecret) : null;
}

export interface CreateSessionInput {
  discordUserId: string;
  accessToken: string;
  refreshToken: string;
  /** アクセストークンの有効期限(Discord OAuth2レスポンスの`expires_in`から算出)。 */
  expiresAt: Date;
  sessionSecret: string;
}

/** Discordトークンを暗号化して`sessions`に保存し、発行したセッションIDを返す。 */
export async function createSession(db: Db, input: CreateSessionInput): Promise<string> {
  const sessionId = randomUUID();
  await db.insert(sessions).values({
    id: sessionId,
    discordUserId: input.discordUserId,
    encryptedAccessToken: encryptToken(input.accessToken, input.sessionSecret),
    encryptedRefreshToken: encryptToken(input.refreshToken, input.sessionSecret),
    expiresAt: input.expiresAt,
  });
  return sessionId;
}
