import { logEntries } from "@management-bot/db";
import { eq } from "drizzle-orm";
import type { LogEntry } from "../domain/index.js";
import { buildLogEntryContainers } from "./log-entry-container.js";
import { selectChannelId, writeLogEntry, type WriteLogEntryDeps } from "./write-log-entry.js";

type ModerationCaseLogEntry = Extract<LogEntry, { category: "moderationCase" }>;

/**
 * moderationCaseに限り、log_entries.idをcaseId(entryIdではなくmoderation.action.recorded
 * イベント共通のcaseId)にする。action="create"と"resolve"が同一caseIdで2回発行され(#350)、
 * 同一idを指すことでupsertの対象にできる。
 */
function moderationCaseLogEntryId(entry: ModerationCaseLogEntry): string {
  return entry.caseId;
}

/**
 * moderation.action.recordedのaction="create"/"resolve"をmoderationCaseログとして書き込む。
 * createは新規insert(通常のwriteLogEntryと同じonConflictDoNothing、caseIdをidに使うだけ)。
 * resolveは同一caseId(=同一id)の既存行をUPDATEし、Discord通知はresult="failed"の場合のみ
 * 追加送信する(createで既に1通送信済みのため、成功時の重複通知を避ける。#350)。
 */
export async function writeModerationCaseLogEntry(deps: WriteLogEntryDeps, entry: ModerationCaseLogEntry): Promise<void> {
  const id = moderationCaseLogEntryId(entry);

  if (entry.action === "create") {
    await writeLogEntry(deps, entry, id);
    return;
  }

  const { db, sendToChannel, getChannelId } = deps;
  await db
    .update(logEntries)
    .set({ payload: entry, authorIsBot: entry.actorIsBot ?? false })
    .where(eq(logEntries.id, id));

  if (entry.result !== "failed") return;

  const resolveChannelId = getChannelId ?? ((guildId: string, category: LogEntry["category"]) => selectChannelId(db, guildId, category));
  const channelId = await resolveChannelId(entry.guildId, entry.category);
  if (channelId === null) return;

  await sendToChannel(channelId, {
    components: buildLogEntryContainers(entry),
    suppressMentions: true,
  });
}
