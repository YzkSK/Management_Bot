import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@management-bot/db";
import { moderationNgwords } from "@management-bot/db";
import { checkRegexSafety, type NgwordEntry, type NgwordMatchType } from "../domain/index.js";

export interface NgwordRow extends NgwordEntry {
  id: string;
}

/**
 * 危険な正規表現(ReDoS典型パターン)の登録を拒否するエラー。tRPC(TRPCError)に依存しない
 * application層固有のエラー型とし、transport層でのマッピングはrouter層の責務とする
 * (Codexレビュー指摘: application層が@trpc/serverに依存するのはレイヤー違反)。
 */
export class UnsafeNgwordRegexError extends Error {
  constructor(reason: string | undefined) {
    super(`unsafe regex pattern: ${reason}`);
    this.name = "UnsafeNgwordRegexError";
  }
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
      throw new UnsafeNgwordRegexError(result.reason);
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
