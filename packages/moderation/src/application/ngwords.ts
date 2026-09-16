import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@management-bot/db";
import { moderationNgwords } from "@management-bot/db";
import { TRPCError } from "@trpc/server";
import { checkRegexSafety, type NgwordEntry, type NgwordMatchType } from "../domain/index.js";

export interface NgwordRow extends NgwordEntry {
  id: string;
}

/** guildIdのNGワード全件を返す。 */
export async function listNgwords(db: Db, guildId: string): Promise<NgwordRow[]> {
  return db
    .select({ id: moderationNgwords.id, matchType: moderationNgwords.matchType, pattern: moderationNgwords.pattern })
    .from(moderationNgwords)
    .where(eq(moderationNgwords.guildId, guildId));
}

/**
 * guildIdにNGワードを追加する。matchType="regex"の場合はcheckRegexSafetyで既知の危険パターン
 * (ReDoS典型パターン)を拒否してから登録する。
 */
export async function addNgword(
  db: Db,
  guildId: string,
  matchType: NgwordMatchType,
  pattern: string,
): Promise<NgwordRow> {
  if (matchType === "regex") {
    const result = checkRegexSafety(pattern);
    if (!result.safe) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `unsafe regex pattern: ${result.reason}` });
    }
  }

  const id = randomUUID();
  await db.insert(moderationNgwords).values({ id, guildId, matchType, pattern });
  return { id, matchType, pattern };
}

/** guildIdのNGワードをidで削除する(未登録の場合は何もしない)。 */
export async function removeNgword(db: Db, guildId: string, id: string): Promise<void> {
  await db.delete(moderationNgwords).where(and(eq(moderationNgwords.guildId, guildId), eq(moderationNgwords.id, id)));
}
