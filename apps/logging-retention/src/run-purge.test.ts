import { describe, expect, mock, test } from "bun:test";
import type { Db } from "@management-bot/db";
import { createPurgeRunner } from "./run-purge.js";

/**
 * db.transaction(cb)は、advisory lock取得(1回目のexecute)とpurgeExpiredLogsが
 * 呼ぶCTEクエリ(2回目以降のexecute)の両方をtxに要求する。呼び出し順に
 * onExecuteの結果を返す。lockAcquired=falseならCTEクエリは呼ばれない
 * 想定(スキップされるため)。
 */
function fakeDb(options: {
  lockAcquired?: boolean;
  purgeRows?: unknown[];
  onPurgeExecute?: () => Promise<unknown[]>;
} = {}): Db {
  const { lockAcquired = true, purgeRows = [], onPurgeExecute } = options;
  let callCount = 0;
  const tx = {
    execute: () => {
      callCount += 1;
      if (callCount === 1) return Promise.resolve([{ acquired: lockAcquired }]);
      return onPurgeExecute?.() ?? Promise.resolve(purgeRows);
    },
  };
  return {
    transaction: (fn: (tx: typeof tx) => Promise<void>) => fn(tx),
  } as unknown as Db;
}

describe("createPurgeRunner", () => {
  test("前回実行が完了していれば通常通り実行する", async () => {
    const onResult = mock(() => {});
    const runner = createPurgeRunner(fakeDb(), onResult);

    await runner.run();

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0]).toContain("deleted 0 entries");
  });

  test("advisory lockを取得できなければpurgeExpiredLogsを呼ばずスキップする(他インスタンス実行中)", async () => {
    const onResult = mock(() => {});
    const onPurgeExecute = mock(() => Promise.resolve([]));
    const runner = createPurgeRunner(fakeDb({ lockAcquired: false, onPurgeExecute }), onResult);

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
        return finishFirst.promise.then(() => []);
      },
    });
    const runner = createPurgeRunner(db, onResult);

    const first = runner.run();
    await started.promise;
    await runner.run();
    finishFirst.resolve();
    await first;

    expect(onResult).toHaveBeenCalledTimes(2);
    expect(onResult.mock.calls.some((call) => call[0]?.includes("Skipping"))).toBe(true);
  });

  test("purgeExpiredLogsが失敗してもonErrorへ通知し、次回実行は妨げない", async () => {
    const onError = mock(() => {});
    const db = fakeDb({ onPurgeExecute: () => Promise.reject(new Error("db error")) });
    const runner = createPurgeRunner(db, () => {}, onError);

    await runner.run();
    await runner.run();

    expect(onError).toHaveBeenCalledTimes(2);
  });

  test("waitForIdleは実行中のジョブがなければ即座に解決する", async () => {
    const runner = createPurgeRunner(fakeDb());
    await expect(runner.waitForIdle()).resolves.toBeUndefined();
  });

  test("waitForIdleは実行中のジョブの完了を待つ(graceful shutdown用)", async () => {
    const finishFirst = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const db = fakeDb({
      onPurgeExecute: () => {
        started.resolve();
        return finishFirst.promise.then(() => []);
      },
    });
    const runner = createPurgeRunner(db);

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
