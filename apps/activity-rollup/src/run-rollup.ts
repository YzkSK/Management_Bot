import { rollupOldHourly } from "@management-bot/activity";
import { createAdvisoryLockRunner, type AdvisoryLockJobRunner, type Db } from "@management-bot/db";

// このジョブ専用のadvisory lockキー(割り当て済みの869_412_501〜504とは別値)。
const ADVISORY_LOCK_KEY = 869_412_505;

export type RollupRunner = AdvisoryLockJobRunner;

/** プロセス内(inFlight)とDB(advisory lock)の二重排他制御付きでrollupOldHourlyを実行する。 */
export function createRollupRunner(
  db: Db,
  onResult: (message: string) => void = console.log,
  onError: (error: unknown) => void = (e) => console.error("Activity rollup job failed:", e),
): RollupRunner {
  return createAdvisoryLockRunner({
    db,
    lockKey: ADVISORY_LOCK_KEY,
    jobName: "activity rollup",
    work: async (tx) => `Activity rollup completed: ${await rollupOldHourly(tx, new Date())} daily rows updated`,
    onResult,
    onError,
  });
}
