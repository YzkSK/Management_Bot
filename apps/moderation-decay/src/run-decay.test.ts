import { describe, expect, mock, test } from "bun:test";
import type { Db } from "@management-bot/db";
import { createDecayRunner } from "./run-decay.js";

/**
 * run-purge.test.tsのfakeDbと同様、advisory lock取得(1回目のexecute)と
 * decayStrikesが発行するUPDATE/DELETE(2回目以降のexecute)の両方をtxに要求する。
 */
function fakeDb(
  options: {
    lockAcquired?: boolean;
    onDecayExecute?: () => Promise<unknown>;
  } = {},
): Db {
  const { lockAcquired = true, onDecayExecute } = options;
  let callCount = 0;
  const tx = {
    execute: () => {
      callCount += 1;
      if (callCount === 1) return Promise.resolve([{ acquired: lockAcquired }]);
      return onDecayExecute?.() ?? Promise.resolve(undefined);
    },
    update: () => ({ set: () => ({ where: () => (onDecayExecute?.() ?? Promise.resolve(undefined)) }) }),
    delete: () => ({ where: () => Promise.resolve(undefined) }),
  };
  return {
    transaction: (fn: (tx: typeof tx) => Promise<void>) => fn(tx),
  } as unknown as Db;
}

describe("createDecayRunner", () => {
  test("前回実行が完了していれば通常通り実行する", async () => {
    const onResult = mock(() => {});
    const runner = createDecayRunner(fakeDb(), onResult);

    await runner.run();

    expect(onResult).toHaveBeenCalledTimes(1);
  });

  test("advisory lockを取得できなければ減衰処理を呼ばずスキップする(他インスタンス実行中)", async () => {
    const onResult = mock(() => {});
    const onDecayExecute = mock(() => Promise.resolve(undefined));
    const runner = createDecayRunner(fakeDb({ lockAcquired: false, onDecayExecute }), onResult);

    await runner.run();

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0]).toContain("another instance is already running");
    expect(onDecayExecute).not.toHaveBeenCalled();
  });

  test("前回実行が完了する前に呼ばれるとスキップする(プロセス内の重複実行ガード)", async () => {
    const onResult = mock(() => {});
    const started = Promise.withResolvers<void>();
    const finishFirst = Promise.withResolvers<void>();
    const db = fakeDb({
      onDecayExecute: () => {
        started.resolve();
        return finishFirst.promise;
      },
    });
    const runner = createDecayRunner(db, onResult);

    const first = runner.run();
    await started.promise;
    await runner.run();
    finishFirst.resolve();
    await first;

    expect(onResult).toHaveBeenCalledTimes(2);
    expect(onResult.mock.calls.some((call) => call[0]?.includes("Skipping"))).toBe(true);
  });

  test("減衰処理が失敗してもonErrorへ通知し、次回実行は妨げない", async () => {
    const onError = mock(() => {});
    const db = fakeDb({ onDecayExecute: () => Promise.reject(new Error("db error")) });
    const runner = createDecayRunner(db, () => {}, onError);

    await runner.run();
    await runner.run();

    expect(onError).toHaveBeenCalledTimes(2);
  });

  test("waitForIdleは実行中のジョブがなければ即座に解決する", async () => {
    const runner = createDecayRunner(fakeDb());
    await expect(runner.waitForIdle()).resolves.toBeUndefined();
  });
});
