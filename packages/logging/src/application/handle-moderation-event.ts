import type { ModerationActionRecordedEvent } from "@management-bot/shared";
import type { LogEntry } from "../domain/index.js";
import { writeLogEntry, type WriteLogEntryDeps } from "./write-log-entry.js";

function toLogEntry(event: ModerationActionRecordedEvent): LogEntry {
  return {
    category: "moderationCase",
    guildId: event.guildId,
    createdAt: event.createdAt,
    caseId: event.caseId,
    targetUserId: event.targetUserId,
    moderatorId: event.moderatorId,
    action: event.action,
    actionType: event.actionType,
  };
}

/**
 * moderation側が発行するmoderation.action.recordedを購読し、moderationCaseカテゴリの
 * ログとして書き込むハンドラ。DomainEventBus.subscribeに渡すことを想定する。
 * entryId(Redis Streamsのエントリid)はstream単位でのみ一意なため、
 * event.typeを前置してlog_entries.id(全体PK)としての一意性を確保する。
 * at-least-once配送による再実行(ハンドラ再試行・XAUTOCLAIMでの再配送)でも
 * ログが重複保存されないようにする。
 */
export function handleModerationEvent(
  deps: WriteLogEntryDeps,
): (event: ModerationActionRecordedEvent, entryId: string) => Promise<void> {
  return (event, entryId) => writeLogEntry(deps, toLogEntry(event), `${event.type}:${entryId}`);
}
