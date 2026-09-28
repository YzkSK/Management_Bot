import { createAdvisoryLockRunner, type AdvisoryLockJobRunner, type Db } from "@management-bot/db";
import { purgeExpiredLogs } from "@management-bot/logging";

// アプリ全体で1つに固定した任意の64bit定数。他機能のadvisory lockと衝突しないよう、
// このジョブ専用のキーとして予約する。
const ADVISORY_LOCK_KEY = 869_412_501;

export type PurgeRunner = AdvisoryLockJobRunner;

/**
 * プロセス内(inFlight)とDB(advisory lock)の二重排他制御付きでpurgeExpiredLogsを実行する
 * (排他制御の詳細はcreateAdvisoryLockRunnerを参照)。
 */
export function createPurgeRunner(
  db: Db,
  onResult: (message: string) => void = console.log,
  onError: (error: unknown) => void = (e) => console.error("Logging retention job failed:", e),
): PurgeRunner {
  return createAdvisoryLockRunner({
    db,
    lockKey: ADVISORY_LOCK_KEY,
    jobName: "logging retention",
    work: async (tx) => {
      const results = await purgeExpiredLogs(tx);
      const totalDeleted = results.reduce((sum, r) => sum + r.deletedCount, 0);
      return `Logging retention job: deleted ${totalDeleted} entries across ${results.length} guild/category`;
    },
    onResult,
    onError,
  });
}
