import type { Db } from "@management-bot/db";
import { decayStrikes } from "@management-bot/moderation";
import { sql } from "drizzle-orm";

// アプリ全体で1つに固定した任意の64bit定数。他機能のadvisory lockと衝突しないよう、
// このジョブ専用のキーとして予約する(logging-retentionの869_412_501とは別値)。
const ADVISORY_LOCK_KEY = 869_412_502;

/** ストライク数が多いほど減少までの時間を長くする基準時間(1ストライクあたりの時間)。 */
const BASE_HOURS = 24;

export interface DecayRunner {
  run: () => Promise<void>;
  /** 実行中のジョブがあれば完了を待つ。graceful shutdown時にcron停止後呼ぶ。 */
  waitForIdle: () => Promise<void>;
}

/**
 * run-purge.ts(logging-retention)と同じ二重排他制御(プロセス内inFlight +
 * DB advisory lock)でdecayStrikesを実行する。
 */
export function createDecayRunner(
  db: Db,
  onResult: (message: string) => void = console.log,
  onError: (error: unknown) => void = (e) => console.error("Moderation decay job failed:", e),
): DecayRunner {
  let inFlight: Promise<void> | undefined;

  async function execute(): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        const [lock] = await tx.execute<{ acquired: boolean }>(
          sql`SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_KEY}) AS acquired`,
        );
        if (!lock?.acquired) {
          onResult("Skipping moderation decay job: another instance is already running it");
          return;
        }
        await decayStrikes(tx, BASE_HOURS);
        onResult("Moderation decay job completed");
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
        onResult("Skipping moderation decay job: previous run is still active");
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
