import { describe, expect, mock, test } from "bun:test";
import type { Db } from "@management-bot/db";
import { createCleanupRunner } from "./run-cleanup.js";

/**
 * run-purge.test.ts(logging-retention)のfakeDbと同様、advisory lock取得(1回目のexecute)と
 * purgeExpiredSessionsが呼ぶCTEクエリ(2回目以降のexecute)の両方をtxに要求する。
 */
function fakeDb(options: {
  lockAcquired?: boolean;
  onPurgeExecute?: () => Promise<unknown[]>;
} = {}): Db {
  const { lockAcquired = true, onPurgeExecute } = options;
  let callCount = 0;
  const tx = {
    execute: () => {
      callCount += 1;
      if (callCount === 1) return Promise.resolve([{ acquired: lockAcquired }]);
      return onPurgeExecute?.() ?? Promise.resolve([{ deleted_count: 3 }]);
    },
  };
  return {
    transaction: (fn: (tx: typeof tx) => Promise<void>) => fn(tx),
  } as unknown as Db;
}

describe("createCleanupRunner", () => {
  test("前回実行が完了していれば通常通り実行し、削除件数を通知する", async () => {
    const onResult = mock(() => {});
    const runner = createCleanupRunner(fakeDb(), onResult);

    await runner.run();

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0]).toBe("Session cleanup job: deleted 3 expired sessions");
  });

  test("advisory lockを取得できなければpurgeExpiredSessionsを呼ばずスキップする(他インスタンス実行中)", async () => {
    const onResult = mock(() => {});
    const onPurgeExecute = mock(() => Promise.resolve([]));
    const runner = createCleanupRunner(fakeDb({ lockAcquired: false, onPurgeExecute }), onResult);

    await runner.run();

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0]).toContain("another instance is already running");
    expect(onPurgeExecute).not.toHaveBeenCalled();
  });

  test("前回実行が完了する前に呼ばれるとスキップする(プロセス内の重複実行ガード)", async () => {
    const onResult = mock(() => {});
    const started = Promise.withResolvers<void>();
    const finishFirst = Promise.withResolvers<void>();
    const db = fakeDb({
      onPurgeExecute: () => {
        started.resolve();
        return finishFirst.promise.then(() => [{ deleted_count: 0 }]);
      },
    });
    const runner = createCleanupRunner(db, onResult);

    const first = runner.run();
    await started.promise;
    await runner.run();
    finishFirst.resolve();
    await first;

    expect(onResult).toHaveBeenCalledTimes(2);
    expect(onResult.mock.calls.some((call) => call[0]?.includes("previous run is still active"))).toBe(true);
  });

  test("削除が失敗してもonErrorへ通知し、次回実行は妨げない", async () => {
    const onError = mock(() => {});
    const db = fakeDb({ onPurgeExecute: () => Promise.reject(new Error("db error")) });
    const runner = createCleanupRunner(db, () => {}, onError);

    await runner.run();
    await runner.run();

    expect(onError).toHaveBeenCalledTimes(2);
  });

  test("waitForIdleは実行中のジョブの完了を待つ(graceful shutdown用)", async () => {
    const finishFirst = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const db = fakeDb({
      onPurgeExecute: () => {
        started.resolve();
        return finishFirst.promise.then(() => [{ deleted_count: 0 }]);
      },
    });
    const runner = createCleanupRunner(db, () => {});

    const run = runner.run();
    await started.promise;

    let idleResolved = false;
    const idle = runner.waitForIdle().then(() => {
      idleResolved = true;
    });
    expect(idleResolved).toBe(false);

    finishFirst.resolve();
    await Promise.all([run, idle]);
    expect(idleResolved).toBe(true);
  });
});
