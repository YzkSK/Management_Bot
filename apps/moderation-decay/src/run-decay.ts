import { createAdvisoryLockRunner, type AdvisoryLockJobRunner, type Db } from "@management-bot/db";
import { decayStrikes } from "@management-bot/moderation";

// アプリ全体で1つに固定した任意の64bit定数。他機能のadvisory lockと衝突しないよう、
// このジョブ専用のキーとして予約する(logging-retentionの869_412_501とは別値)。
const ADVISORY_LOCK_KEY = 869_412_502;

/** ストライク数が多いほど減少までの時間を長くする基準時間(1ストライクあたりの時間)。 */
const BASE_HOURS = 24;

export type DecayRunner = AdvisoryLockJobRunner;

/**
 * プロセス内(inFlight)とDB(advisory lock)の二重排他制御付きでdecayStrikesを実行する
 * (排他制御の詳細はcreateAdvisoryLockRunnerを参照)。
 */
export function createDecayRunner(
  db: Db,
  onResult: (message: string) => void = console.log,
  onError: (error: unknown) => void = (e) => console.error("Moderation decay job failed:", e),
): DecayRunner {
  return createAdvisoryLockRunner({
    db,
    lockKey: ADVISORY_LOCK_KEY,
    jobName: "moderation decay",
    work: async (tx) => {
      await decayStrikes(tx, BASE_HOURS);
      return "Moderation decay job completed";
    },
    onResult,
    onError,
  });
}
