import type { ScheduledPostEventRecordedEvent } from "@management-bot/shared";
import type { LogEntry } from "../domain/index.js";
import { writeLogEntry, type WriteLogEntryDeps } from "./write-log-entry.js";

type ScheduledPostLogEntry = Extract<LogEntry, { category: "scheduledPost" }>;

function isDeletedGuildForeignKeyViolation(error: unknown): boolean {
  const matches = (value: unknown): boolean => {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as { code?: unknown; constraint_name?: unknown };
    return candidate.code === "23503" && candidate.constraint_name === "log_entries_guild_id_guilds_id_fk";
  };
  return matches(error) || (error instanceof Error && matches(error.cause));
}

function toLogEntry(event: ScheduledPostEventRecordedEvent): ScheduledPostLogEntry {
  const base = {
    category: "scheduledPost" as const,
    guildId: event.guildId,
    postId: event.postId,
    channelId: event.channelId,
    channelName: event.channelName,
    authorId: event.authorId,
    authorName: event.authorName,
    createdAt: event.createdAt,
    executorId: event.executorId,
    executorName: event.executorName,
  };
  switch (event.action) {
    case "created":
      return { ...base, action: "created", content: event.content, scheduledAt: event.scheduledAt };
    case "edited":
      return {
        ...base,
        action: "edited",
        content: event.after.content,
        previousContent: event.before.content,
        scheduledAt: event.after.scheduledAt,
        previousScheduledAt: event.before.scheduledAt,
      };
    case "cancelled":
      return { ...base, action: "cancelled", by: event.by, scheduledAt: event.scheduledAt };
    case "posted":
      return { ...base, action: "posted", messageId: event.messageId, scheduledAt: event.scheduledAt };
    case "failed":
      return { ...base, action: "failed", reason: event.reason, scheduledAt: event.scheduledAt };
  }
}

/**
 * scheduled-post側が発行するscheduled-post.event.recordedを購読し、scheduledPostカテゴリの
 * ログとして書き込む。at-least-once配送のため、entryIdを冪等キーとして書き込む(handleTempVoiceEventと同じ)。
 */
export function handleScheduledPostEvent(
  deps: WriteLogEntryDeps,
): (event: ScheduledPostEventRecordedEvent, entryId: string) => Promise<void> {
  return async (event, entryId) => {
    try {
      await writeLogEntry(deps, toLogEntry(event), `scheduled-post.event.recorded:${entryId}`);
    } catch (error) {
      // guild削除後の古いイベントは再試行しても成功しない。正常終了としてACKする。
      if (isDeletedGuildForeignKeyViolation(error)) return;
      throw error;
    }
  };
}
