import { purgeExpiredSessions } from "@management-bot/dashboard-access";
import type { Db } from "@management-bot/db";
import { sql } from "drizzle-orm";

// アプリ全体で1つに固定した任意の64bit定数。他機能のadvisory lockと衝突しないよう、
// このジョブ専用のキーとして予約する(logging-retentionの869_412_501、
// moderation-decayの869_412_502、temp-voice run-graceの869_412_503とは別値)。
const ADVISORY_LOCK_KEY = 869_412_504;

export interface CleanupRunner {
  run: () => Promise<void>;
  /** 実行中のジョブがあれば完了を待つ。graceful shutdown時にcron停止後呼ぶ。 */
  waitForIdle: () => Promise<void>;
}

/**
 * 前回実行が終わっていなければスキップする重複実行ガード付きの実行関数を作る。
 * logging-retention(run-purge.ts)と同じく二重の排他制御を行う:
 * 1. プロセス内(inFlight): 同一プロセスでcronのtickが前回実行と重なるのを防ぐ。
 * 2. DB(pg_try_advisory_xact_lock): 複数レプリカで動かした場合に、複数プロセスが
 *    同時にDELETEを実行するのを防ぐ。トランザクションスコープのロックなので
 *    commit/rollback時に自動解放され、プロセスが異常終了してもロックが残留しない。
 */
export function createCleanupRunner(
  db: Db,
  onResult: (message: string) => void = console.log,
  onError: (error: unknown) => void = (e) => console.error("Session cleanup job failed:", e),
): CleanupRunner {
  let inFlight: Promise<void> | undefined;

  async function execute(): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        const [lock] = await tx.execute<{ acquired: boolean }>(
          sql`SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_KEY}) AS acquired`,
        );
        if (!lock?.acquired) {
          onResult("Skipping session cleanup job: another instance is already running it");
          return;
        }
        const deleted = await purgeExpiredSessions(tx);
        onResult(`Session cleanup job: deleted ${deleted} expired sessions`);
      });
    } catch (error) {
      onError(error);
    } finally {
      inFlight = undefined;
    }
  }

  return {
    async run() {
      if (inFlight) {
        onResult("Skipping session cleanup job: previous run is still active");
        return;
      }
      inFlight = execute();
      await inFlight;
    },
    async waitForIdle() {
      await inFlight;
    },
  };
}
