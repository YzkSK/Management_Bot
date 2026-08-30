import { randomUUID } from "node:crypto";
import { sessions, type Db } from "@management-bot/db";
import { and, eq, gt } from "drizzle-orm";
import { encryptToken } from "./token-crypto.js";

export interface ValidatedSession {
  discordUserId: string;
}

export async function validateSession(
  db: Db,
  sessionId: string,
): Promise<ValidatedSession | null> {
  const [row] = await db
    .select({ discordUserId: sessions.discordUserId })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return row ?? null;
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
