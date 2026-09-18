import { logEntries } from "@management-bot/db";
import { eq } from "drizzle-orm";
import type { LogEntry } from "../domain/index.js";
import { buildLogEntryContainers } from "./log-entry-container.js";
import { selectChannelId, writeLogEntry, type WriteLogEntryDeps } from "./write-log-entry.js";

type ModerationCaseLogEntry = Extract<LogEntry, { category: "moderationCase" }>;

/**
 * moderationCaseに限り、log_entries.idをcaseId+targetUserId(entryIdではなく
 * moderation.action.recordedイベント共通のcaseId)にする。action="create"と"resolve"が
 * 同一caseId・同一targetUserIdで2回発行され(#350)、同一idを指すことでupsertの対象にできる。
 * targetUserIdも含めるのは、raid一括timeoutが対象ユーザー全員へ同一caseIdでイベントを
 * 発行するため(guild-member-add.ts参照)。caseIdのみをidにすると対象ユーザー分のログ行が
 * 1行に潰れてしまう(codexレビュー指摘)。
 */
function moderationCaseLogEntryId(entry: ModerationCaseLogEntry): string {
  return `${entry.caseId}:${entry.targetUserId}`;
}

/**
 * moderation.action.recordedのaction="create"/"resolve"をmoderationCaseログとして書き込む。
 * createは新規insert(通常のwriteLogEntryと同じonConflictDoNothing、caseIdをidに使うだけ)。
 * resolveは同一caseId(=同一id)の既存行をUPDATEし、Discord通知はresult="failed"の場合のみ
 * 追加送信する(createで既に1通送信済みのため、成功時の重複通知を避ける。#350)。
 * resolveがcreateより先に(または単独で)処理された場合、UPDATE対象の行がまだ存在しないため、
 * 更新0件ならresolveの内容でinsertする(onConflictDoNothing、後からcreateが遅れて届いても
 * 上書きしない。codexレビュー指摘: 更新0件を無視すると行が永久に欠落するバグがあった)。
 * このフォールバックinsertではwriteLogEntryを使わず直接insertのみ行う(writeLogEntryは
 * 保存の都度チャンネル送信も行うため、ここで使うとresolveの内容が「作成」通知として送られ、
 * 後続のresult="failed"追加通知と二重送信になってしまうため)。
 */
export async function writeModerationCaseLogEntry(deps: WriteLogEntryDeps, entry: ModerationCaseLogEntry): Promise<void> {
  const id = moderationCaseLogEntryId(entry);

  if (entry.action === "create") {
    await writeLogEntry(deps, entry, id);
    return;
  }

  const { db, sendToChannel, getChannelId } = deps;
  const updated = await db
    .update(logEntries)
    .set({ payload: entry, authorIsBot: entry.actorIsBot ?? false })
    .where(eq(logEntries.id, id))
    .returning({ id: logEntries.id });

  if (updated.length === 0) {
    await db
      .insert(logEntries)
      .values({
        id,
        guildId: entry.guildId,
        category: entry.category,
        authorIsBot: entry.actorIsBot ?? false,
        payload: entry,
        createdAt: new Date(entry.createdAt),
      })
      .onConflictDoNothing();
  }

  if (entry.result !== "failed") return;

  const resolveChannelId = getChannelId ?? ((guildId: string, category: LogEntry["category"]) => selectChannelId(db, guildId, category));
  const channelId = await resolveChannelId(entry.guildId, entry.category);
  if (channelId === null) return;

  await sendToChannel(channelId, {
    components: buildLogEntryContainers(entry),
    suppressMentions: true,
  });
}
