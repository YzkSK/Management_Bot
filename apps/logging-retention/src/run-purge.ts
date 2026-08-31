import type { Db } from "@management-bot/db";
import { purgeExpiredLogs } from "@management-bot/logging";
import { sql } from "drizzle-orm";

// アプリ全体で1つに固定した任意の64bit定数。他機能のadvisory lockと衝突しないよう、
// このジョブ専用のキーとして予約する。
const ADVISORY_LOCK_KEY = 869_412_501;

export interface PurgeRunner {
  run: () => Promise<void>;
  /** 実行中のジョブがあれば完了を待つ。graceful shutdown時にcron停止後呼ぶ。 */
  waitForIdle: () => Promise<void>;
}

/**
 * 前回実行が終わっていなければスキップする重複実行ガード付きの実行関数を作る。
 * 二重の排他制御を行う:
 * 1. プロセス内(inFlight): 同一プロセスでcronのtickが前回実行と重なるのを防ぐ。
 * 2. DB(pg_try_advisory_xact_lock): logging-retentionを複数レプリカで動かした
 *    場合に、複数プロセスが同時にDELETEを実行するのを防ぐ。トランザクション
 *    スコープのロックなのでcommit/rollback時に自動解放され、プロセスが
 *    異常終了してもロックが残留しない。
 */
export function createPurgeRunner(
  db: Db,
  onResult: (message: string) => void = console.log,
  onError: (error: unknown) => void = (e) => console.error("Logging retention job failed:", e),
): PurgeRunner {
  let inFlight: Promise<void> | undefined;

  async function execute(): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        const [lock] = await tx.execute<{ acquired: boolean }>(
          sql`SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_KEY}) AS acquired`,
        );
        if (!lock?.acquired) {
          onResult("Skipping logging retention job: another instance is already running it");
          return;
        }
        const results = await purgeExpiredLogs(tx);
        const totalDeleted = results.reduce((sum, r) => sum + r.deletedCount, 0);
        onResult(`Logging retention job: deleted ${totalDeleted} entries across ${results.length} guild/category`);
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
        onResult("Skipping logging retention job: previous run is still active");
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
