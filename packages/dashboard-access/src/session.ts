import { sessions, type Db } from "@management-bot/db";
import { and, eq, gt } from "drizzle-orm";

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
