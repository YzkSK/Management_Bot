import type { Db } from "@management-bot/db";
import { purgeExpiredLogs } from "@management-bot/logging";

/**
 * 前回実行が終わっていなければスキップする重複実行ガード付きの実行関数を作る。
 * cronのtickが前回実行の完了より先に来た場合、同時に複数回のDELETEが走るのを防ぐ
 * (apps/backup/src/index.tsのrunningフラグと同じ方式)。
 */
export function createPurgeRunner(
  db: Db,
  onResult: (message: string) => void = console.log,
  onError: (error: unknown) => void = (e) => console.error("Logging retention job failed:", e),
): () => Promise<void> {
  let running = false;

  return async function runPurge(): Promise<void> {
    if (running) {
      onResult("Skipping logging retention job: previous run is still active");
      return;
    }
    running = true;
    try {
      const results = await purgeExpiredLogs(db);
      const totalDeleted = results.reduce((sum, r) => sum + r.deletedCount, 0);
      onResult(`Logging retention job: deleted ${totalDeleted} entries across ${results.length} guild/category`);
    } catch (error) {
      onError(error);
    } finally {
      running = false;
    }
  };
}
