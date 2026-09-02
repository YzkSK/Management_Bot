import type { LogEntry } from "../domain/index.js";
import { writeLogEntry, type WriteLogEntryDeps } from "../application/index.js";

/**
 * discord.jsのイベントリスナーは同期コールバックで再配送の仕組みもないため、
 * writeLogEntryの失敗をthrowしても誰にも伝播しない(domain-events購読のhandleModerationEventとは異なる)。
 * ここで握りつぶしログ出力のみ行い、1件の書き込み失敗で以降のイベント処理を止めないようにする。
 */
export function writeLogEntrySafely(deps: WriteLogEntryDeps, entry: LogEntry): void {
  void writeLogEntry(deps, entry).catch((error: unknown) => {
    console.error(`Failed to write log entry (category=${entry.category})`, error);
  });
}
