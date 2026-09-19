import { and, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "./client.js";
import { moderationMessageDeletionLinks } from "./schema/moderation.js";

const LINK_TTL_MS = 15 * 60 * 1000;

export interface RecordModerationMessageDeletionLinksInput {
  guildId: string;
  caseId: string;
  messageIds: readonly string[];
}

export async function recordModerationMessageDeletionLinks(
  db: Db,
  input: RecordModerationMessageDeletionLinksInput,
): Promise<void> {
  const messageIds = [...new Set(input.messageIds)];
  if (messageIds.length === 0) return;

  const expiresAt = new Date(Date.now() + LINK_TTL_MS);
  await db
    .insert(moderationMessageDeletionLinks)
    .values(messageIds.map((messageId) => ({ guildId: input.guildId, messageId, caseId: input.caseId, expiresAt })))
    .onConflictDoUpdate({
      target: [moderationMessageDeletionLinks.guildId, moderationMessageDeletionLinks.messageId],
      set: { caseId: input.caseId, expiresAt },
    });
}

export async function findModerationCaseIdForDeletedMessages(
  db: Db,
  guildId: string,
  ids: readonly string[],
): Promise<string | null> {
  const messageIds = [...new Set(ids)];
  if (messageIds.length === 0) return null;

  const query = db
    .select({ messageId: moderationMessageDeletionLinks.messageId, caseId: moderationMessageDeletionLinks.caseId })
    .from(moderationMessageDeletionLinks)
    .where(
      and(
        eq(moderationMessageDeletionLinks.guildId, guildId),
        inArray(moderationMessageDeletionLinks.messageId, messageIds),
        gt(moderationMessageDeletionLinks.expiresAt, new Date()),
      ),
    );
  const rows = await query;

  if (rows.length !== messageIds.length) return null;
  const caseIds = new Set(rows.map((row) => row.caseId));
  return caseIds.size === 1 ? (caseIds.values().next().value ?? null) : null;
}
