import { purgeExpiredSessions } from "@management-bot/dashboard-access";
import { createAdvisoryLockRunner, type AdvisoryLockJobRunner, type Db } from "@management-bot/db";

// アプリ全体で1つに固定した任意の64bit定数。他機能のadvisory lockと衝突しないよう、
// このジョブ専用のキーとして予約する(logging-retentionの869_412_501、
// moderation-decayの869_412_502、temp-voice run-graceの869_412_503とは別値)。
const ADVISORY_LOCK_KEY = 869_412_504;

export type CleanupRunner = AdvisoryLockJobRunner;

/**
 * プロセス内(inFlight)とDB(advisory lock)の二重排他制御付きでpurgeExpiredSessionsを実行する
 * (排他制御の詳細はcreateAdvisoryLockRunnerを参照)。
 */
export function createCleanupRunner(
  db: Db,
  onResult: (message: string) => void = console.log,
  onError: (error: unknown) => void = (e) => console.error("Session cleanup job failed:", e),
): CleanupRunner {
  return createAdvisoryLockRunner({
    db,
    lockKey: ADVISORY_LOCK_KEY,
    jobName: "session cleanup",
    work: async (tx) => {
      const deleted = await purgeExpiredSessions(tx);
      return `Session cleanup job: deleted ${deleted} expired sessions`;
    },
    onResult,
    onError,
  });
}
