import type { ModerationActionRecordedEvent } from "@management-bot/shared";
import type { LogEntry } from "../domain/index.js";
import { writeModerationCaseLogEntry } from "./write-moderation-case-log-entry.js";
import type { WriteLogEntryDeps } from "./write-log-entry.js";

type ModerationCaseLogEntry = Extract<LogEntry, { category: "moderationCase" }>;

function toLogEntry(event: ModerationActionRecordedEvent): ModerationCaseLogEntry {
  const base = {
    category: "moderationCase" as const,
    guildId: event.guildId,
    createdAt: event.createdAt,
    caseId: event.caseId,
    targetUserId: event.targetUserId,
    moderatorId: event.moderatorId,
    actionType: event.actionType,
    timeoutMinutes: event.timeoutMinutes,
  };
  return event.action === "create"
    ? { ...base, action: "create" }
    : { ...base, action: "resolve", result: event.result, failureCode: event.failureCode };
}

/**
 * moderation側が発行するmoderation.action.recordedを購読し、moderationCaseカテゴリの
 * ログとして書き込むハンドラ。DomainEventBus.subscribeに渡すことを想定する。
 * action="create"/"resolve"は同一caseIdで2回発行され(#350)、log_entries.idにcaseIdを
 * 使うことで同一行への新規insert/UPDATEとして扱う(writeModerationCaseLogEntry参照)。
 * entryId(Redis Streamsのエントリid)は他カテゴリの冪等キー(`${type}:${entryId}`)としては
 * 使われるが、moderationCaseはcaseId自体が冪等キーを兼ねるため使わない。
 */
export function handleModerationEvent(
  deps: WriteLogEntryDeps,
): (event: ModerationActionRecordedEvent, entryId: string) => Promise<void> {
  return (event) => writeModerationCaseLogEntry(deps, toLogEntry(event));
}
