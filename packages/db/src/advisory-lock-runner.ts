import { sql } from "drizzle-orm";
import type { Db } from "./client.js";

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface AdvisoryLockJobRunner {
  run: () => Promise<void>;
  /** 実行中のジョブがあれば完了を待つ。graceful shutdown時にcron停止後呼ぶ。 */
  waitForIdle: () => Promise<void>;
}

export interface AdvisoryLockJobOptions {
  db: Db;
  /**
   * pg_try_advisory_xact_lockに渡す、ジョブごとに固定した64bit定数。他のジョブと衝突させないこと。
   * 割り当て済み: 869_412_501 logging-retention / 869_412_502 moderation-decay /
   * 869_412_503 temp-voice run-grace / 869_412_504 session-cleanup /
   * 869_412_505 activity-rollup。
   */
  lockKey: number;
  /** スキップ時のメッセージに使うジョブ名(例: "logging retention")。 */
  jobName: string;
  /** ロック取得後、同じトランザクション内で実行する処理。onResultへ渡す完了メッセージを返す。 */
  work: (tx: DbTransaction) => Promise<string>;
  onResult: (message: string) => void;
  onError: (error: unknown) => void;
}

/**
 * 前回実行が終わっていなければスキップする重複実行ガード付きの実行関数を作る。
 * cronで定期実行するジョブ(logging-retention/moderation-decay/session-cleanup)で共通。
 * 二重の排他制御を行う:
 * 1. プロセス内(inFlight): 同一プロセスでcronのtickが前回実行と重なるのを防ぐ。
 * 2. DB(pg_try_advisory_xact_lock): 複数レプリカで動かした場合に、複数プロセスが
 *    同時にジョブを実行するのを防ぐ。トランザクションスコープのロックなので
 *    commit/rollback時に自動解放され、プロセスが異常終了してもロックが残留しない。
 */
export function createAdvisoryLockRunner({
  db,
  lockKey,
  jobName,
  work,
  onResult,
  onError,
}: AdvisoryLockJobOptions): AdvisoryLockJobRunner {
  let inFlight: Promise<void> | undefined;

  async function execute(): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        const [lock] = await tx.execute<{ acquired: boolean }>(
          sql`SELECT pg_try_advisory_xact_lock(${lockKey}) AS acquired`,
        );
        if (!lock?.acquired) {
          onResult(`Skipping ${jobName} job: another instance is already running it`);
          return;
        }
        onResult(await work(tx));
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
        onResult(`Skipping ${jobName} job: previous run is still active`);
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

/**
 * SIGTERM/SIGINTを受けたら、cronのタイマーを止めてから実行中のジョブの完了を待ち、DBを閉じて終了する。
 * タイマーを止めずにcloseだけ呼ぶとプロセスがtimer keep-aliveで終了しない。
 */
export function stopJobOnSignal(
  task: { stop: () => void },
  runner: Pick<AdvisoryLockJobRunner, "waitForIdle">,
  close: () => Promise<void>,
): void {
  async function shutdown() {
    task.stop();
    await runner.waitForIdle();
    await close();
    process.exit(0);
  }
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}
