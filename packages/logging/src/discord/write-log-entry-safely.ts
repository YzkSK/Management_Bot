import type { LogEntry } from "../domain/index.js";
import { writeLogEntriesBulk, writeLogEntry, type WriteLogEntryDeps } from "../application/index.js";

/**
 * discord.jsのイベントリスナーは同期コールバックで再配送の仕組みもないため、
 * writeLogEntryの失敗をthrowしても誰にも伝播しない(domain-events購読のhandleModerationEventとは異なる)。
 * ここで握りつぶしログ出力のみ行い、1件の書き込み失敗で以降のイベント処理を止めないようにする。
 */
export function writeLogEntrySafely(deps: WriteLogEntryDeps, entry: LogEntry, id?: string, skipNotifyIfExists?: boolean): void {
  void writeLogEntry(deps, entry, id, skipNotifyIfExists).catch((error: unknown) => {
    console.error(`Failed to write log entry (category=${entry.category})`, error);
  });
}

/** writeLogEntrySafelyのバルク版。writeLogEntriesBulkの失敗を握りつぶす。 */
export function writeLogEntriesBulkSafely(
  deps: WriteLogEntryDeps,
  entries: readonly LogEntry[],
  summary: (entries: readonly LogEntry[]) => string,
): void {
  void writeLogEntriesBulk(deps, entries, summary).catch((error: unknown) => {
    console.error(`Failed to write log entries in bulk (count=${entries.length})`, error);
  });
}
