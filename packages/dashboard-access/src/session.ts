import { randomUUID } from "node:crypto";
import { sessions, type Db } from "@management-bot/db";
import { and, eq, gt, sql, type TablesRelationalConfig } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import { decryptToken, encryptToken } from "./token-crypto.js";

export interface ValidatedSession {
  discordUserId: string;
  discordUsername: string;
  expiresAt: Date;
}

export async function validateSession(
  db: Db,
  sessionId: string,
): Promise<ValidatedSession | null> {
  const [row] = await db
    .select({
      discordUserId: sessions.discordUserId,
      discordUsername: sessions.discordUsername,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return row ?? null;
}

/** ログアウト時にセッション行を削除する。存在しないIDでも成功扱い(冪等)。 */
export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
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
  discordUsername: string;
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
    discordUsername: input.discordUsername,
    encryptedAccessToken: encryptToken(input.accessToken, input.sessionSecret),
    encryptedRefreshToken: encryptToken(input.refreshToken, input.sessionSecret),
    expiresAt: input.expiresAt,
  });
  return sessionId;
}

type PurgeRow = Record<string, unknown> & { deleted_count: number };

/**
 * `expiresAt`が`now`以前のセッション行を削除し、削除件数を返す。期限切れセッションは
 * validateSession/getSessionAccessTokenのどちらからも参照されないため残す意味がなく、
 * 暗号化済みトークンを不要に保持し続けないためにも削除する。
 *
 * purgeExpiredLogs(@management-bot/logging)と同じ理由で、PgDatabase(通常のDb)・
 * PgTransaction(db.transaction内のtx)のどちらでも受け取れるようジェネリクスで受ける
 * (apps/session-cleanupでadvisory lock取得後にtx経由で呼び出すため)。
 * 削除行はCTE内で件数に集計し、行本体をアプリ側へ転送しない。
 */
export async function purgeExpiredSessions<
  TFullSchema extends Record<string, unknown>,
  TSchema extends TablesRelationalConfig,
>(
  db: PgDatabase<PostgresJsQueryResultHKT, TFullSchema, TSchema>,
  now: Date = new Date(),
): Promise<number> {
  const [row] = await db.execute<PurgeRow>(sql`
    WITH deleted AS (
      DELETE FROM ${sessions}
      WHERE ${sessions.expiresAt} <= ${now.toISOString()}::timestamptz
      RETURNING 1
    )
    SELECT count(*)::int AS deleted_count FROM deleted
  `);
  return row?.deleted_count ?? 0;
}
