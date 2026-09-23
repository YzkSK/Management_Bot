import type { TempVoiceEventRecordedEvent } from "@management-bot/shared";
import type { LogEntry } from "../domain/index.js";
import { writeLogEntry, type WriteLogEntryDeps } from "./write-log-entry.js";

type TempVoiceLogEntry = Extract<LogEntry, { category: "tempVoice" }>;

function isDeletedGuildForeignKeyViolation(error: unknown): boolean {
  const matches = (value: unknown): boolean => {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as { code?: unknown; constraint_name?: unknown };
    return candidate.code === "23503" && candidate.constraint_name === "log_entries_guild_id_guilds_id_fk";
  };
  return matches(error) || (error instanceof Error && matches(error.cause));
}

function toLogEntry(event: TempVoiceEventRecordedEvent): TempVoiceLogEntry {
  const base = {
    category: "tempVoice" as const,
    guildId: event.guildId,
    channelId: event.channelId,
    createdAt: event.createdAt,
    executorId: event.executorId,
    executorName: event.executorName,
  };
  switch (event.action) {
    case "created":
      return { ...base, action: "created", ownerId: event.ownerId, ownerName: event.ownerName, controlChannelId: event.controlChannelId };
    case "deleted":
      return { ...base, action: "deleted", ownerId: event.ownerId, ownerName: event.ownerName };
    case "renamed":
      return { ...base, action: "renamed", before: event.before, after: event.after };
    case "permissionChanged":
      return { ...base, action: "permissionChanged", permission: event.permission, allowed: event.allowed };
    case "userLimitChanged":
      return { ...base, action: "userLimitChanged", before: event.before, after: event.after };
    case "bitrateChanged":
      return { ...base, action: "bitrateChanged", before: event.before, after: event.after };
    case "ownerTransferred":
      return {
        ...base,
        action: "ownerTransferred",
        previousOwnerId: event.previousOwnerId,
        previousOwnerName: event.previousOwnerName,
        newOwnerId: event.newOwnerId,
        newOwnerName: event.newOwnerName,
        trigger: event.trigger,
      };
    case "memberPermissionChanged":
      return {
        ...base,
        action: "memberPermissionChanged",
        state: event.state,
        targetType: event.targetType,
        targetId: event.targetId,
        targetName: event.targetName,
      };
  }
}

/**
 * temp-voice側が発行するtemp-voice.event.recordedを購読し、tempVoiceカテゴリのログとして書き込む
 * ハンドラ。DomainEventBus.subscribeに渡すことを想定する。全actionをlog_channel_settingsの
 * Discord通知対象にする(#413)。moderationCaseと異なり各actionは1回のみ発行されるため、
 * 通常のwriteLogEntry(entryIdを冪等キーとして使う)で書き込む。
 */
export function handleTempVoiceEvent(
  deps: WriteLogEntryDeps,
): (event: TempVoiceEventRecordedEvent, entryId: string) => Promise<void> {
  return async (event, entryId) => {
    try {
      await writeLogEntry(deps, toLogEntry(event), `temp-voice.event.recorded:${entryId}`);
    } catch (error) {
      // guild削除後の古いイベントは再試行しても成功しない。正常終了としてACKする。
      if (isDeletedGuildForeignKeyViolation(error)) return;
      throw error;
    }
  };
}
