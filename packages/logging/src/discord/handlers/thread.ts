import type { FeatureModuleContext } from "@management-bot/core";
import type { AnyThreadChannel } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import type { WriteLogEntryDeps } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";
import { writeLogEntrySafely } from "../write-log-entry-safely.js";

/** parentIdがnullな(親チャンネル不明な)スレッドはchannelId必須のschemaを満たせないためスキップする。 */
function baseFields(thread: AnyThreadChannel): { guildId: string; threadId: string; channelId: string } | undefined {
  if (!thread.parentId) return undefined;
  return { guildId: thread.guildId, threadId: thread.id, channelId: thread.parentId };
}

export function toThreadCreateLogEntry(thread: AnyThreadChannel): LogEntry | undefined {
  const base = baseFields(thread);
  if (!base) return undefined;
  return { category: "thread", ...base, createdAt: new Date().toISOString(), action: "create" };
}

export function toThreadDeleteLogEntry(thread: AnyThreadChannel): LogEntry | undefined {
  const base = baseFields(thread);
  if (!base) return undefined;
  return { category: "thread", ...base, createdAt: new Date().toISOString(), action: "delete" };
}

/** archived差分をarchive/unarchiveとして記録し、それ以外(名前変更・ロック等)はupdateとして記録する。 */
export function toThreadUpdateLogEntry(oldThread: AnyThreadChannel, newThread: AnyThreadChannel): LogEntry | undefined {
  const base = baseFields(newThread);
  if (!base) return undefined;
  const action = oldThread.archived === newThread.archived ? "update" : newThread.archived ? "archive" : "unarchive";
  return { category: "thread", ...base, createdAt: new Date().toISOString(), action };
}

export function registerThreadHandlers(ctx: FeatureModuleContext): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx) };

  ctx.client.on("threadCreate", (thread) => {
    const entry = toThreadCreateLogEntry(thread);
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
}
