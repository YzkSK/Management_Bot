import type { FeatureModuleContext } from "@management-bot/core";
import type { AnyThreadChannel, PartialThreadMember, ReadonlyCollection, Snowflake, ThreadMember } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import type { WriteLogEntryDeps } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";
import { writeLogEntrySafely } from "../write-log-entry-safely.js";

/**
 * parentIdがnullな(親チャンネル不明な)スレッドはchannelId必須のschemaを満たせないためスキップする。
 * threadNameはイベント発生時点のスナップショット。Discord REST APIのアクティブスレッド一覧は
 * アーカイブ・削除済みスレッドを含まないため、表示名解決をAPI頼みにせずログ側に保持する
 * (codexレビュー指摘)。
 */
function baseFields(
  thread: AnyThreadChannel,
): { guildId: string; threadId: string; channelId: string; threadName: string } | undefined {
  if (!thread.parentId) return undefined;
  return { guildId: thread.guildId, threadId: thread.id, channelId: thread.parentId, threadName: thread.name };
}

export function toThreadCreateLogEntry(thread: AnyThreadChannel, content?: string): LogEntry | undefined {
  const base = baseFields(thread);
  if (!base) return undefined;
  return { category: "thread", ...base, createdAt: new Date().toISOString(), action: "create", content };
}

export function toThreadDeleteLogEntry(thread: AnyThreadChannel): LogEntry | undefined {
  const base = baseFields(thread);
  if (!base) return undefined;
  return { category: "thread", ...base, createdAt: new Date().toISOString(), action: "delete" };
}

/**
 * archived差分をarchive/unarchiveとして記録し、それ以外(名前変更・ロック等)はupdateとして記録する。
 * archivedはboolean|nullで、null(状態不明)は差分ありと誤判定しないようboolean同士の比較に限定する
 * (codexレビュー指摘: null→falseを誤ってunarchiveと記録するバグの修正)。
 */
export function toThreadUpdateLogEntry(oldThread: AnyThreadChannel, newThread: AnyThreadChannel): LogEntry | undefined {
  const base = baseFields(newThread);
  if (!base) return undefined;
  const archiveStateChanged =
    oldThread.archived !== null && newThread.archived !== null && oldThread.archived !== newThread.archived;
  const action = archiveStateChanged ? (newThread.archived ? "archive" : "unarchive") : "update";
  return { category: "thread", ...base, createdAt: new Date().toISOString(), action };
}

/**
 * role.tsのtoRoleMembershipLogEntries(memberAdd/memberRemove)と同じパターンで、
 * threadMembersUpdateのaddedMembers/removedMembersを対象メンバーごとのLogEntryに変換する。
 */
export function toThreadMembershipLogEntries(
  addedMembers: ReadonlyCollection<Snowflake, ThreadMember>,
  removedMembers: ReadonlyCollection<Snowflake, ThreadMember | PartialThreadMember>,
  thread: AnyThreadChannel,
): LogEntry[] {
  const base = baseFields(thread);
  if (!base) return [];
  const createdAt = new Date().toISOString();
  const entries: LogEntry[] = [];
  for (const userId of addedMembers.keys()) {
    entries.push({ category: "thread", ...base, createdAt, userId, action: "memberAdd" });
  }
  for (const userId of removedMembers.keys()) {
    entries.push({ category: "thread", ...base, createdAt, userId, action: "memberRemove" });
  }
  return entries;
}

/**
 * フォーラム/メディア投稿はスレッド自体がスターターメッセージ(投稿本文)を持つ。
 * 既存メッセージから作成した通常スレッドは元メッセージを指すだけで「投稿本文」ではないため取得しない。
 * 取得失敗(権限不足・削除済み等)はcontentなしのログとして扱う(ベストエフォート)。
 * ponytail: thread.parentはキャッシュ依存(未キャッシュ時はnull)のため、親が未解決の場合も
 * contentなしにフォールバックする。取得漏れが問題になる場合はthread.parentIdからfetchする経路を追加する。
 */
export async function fetchThreadStarterContent(thread: AnyThreadChannel): Promise<string | undefined> {
  if (!thread.parent?.isThreadOnly()) return undefined;
  const message = await thread.fetchStarterMessage().catch((error: unknown) => {
    console.error(`Failed to fetch starter message for thread ${thread.id}`, error);
    return null;
  });
  return message?.content ?? undefined;
}

export function registerThreadHandlers(ctx: FeatureModuleContext): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx) };

  ctx.client.on("threadCreate", async (thread) => {
    const content = await fetchThreadStarterContent(thread);
    const entry = toThreadCreateLogEntry(thread, content);
    if (entry) writeLogEntrySafely(deps, entry);
  });
  ctx.client.on("threadDelete", (thread) => {
    const entry = toThreadDeleteLogEntry(thread);
    if (entry) writeLogEntrySafely(deps, entry);
  });
  ctx.client.on("threadUpdate", (oldThread, newThread) => {
    const entry = toThreadUpdateLogEntry(oldThread, newThread);
    if (entry) writeLogEntrySafely(deps, entry);
  });
  ctx.client.on("threadMembersUpdate", (addedMembers, removedMembers, thread) => {
    for (const entry of toThreadMembershipLogEntries(addedMembers, removedMembers, thread)) {
      writeLogEntrySafely(deps, entry);
    }
  });
}
