import { describe, expect, mock, test } from "bun:test";
import type { Db } from "@management-bot/db";
import { createRollupRunner } from "./run-rollup.js";

/** 1回目のexecuteはadvisory lock取得、2回目以降はロールアップのSQL(結果行の配列を返す)。 */
function fakeDb(options: { lockAcquired?: boolean; onRollupExecute?: () => Promise<unknown[]> } = {}): Db {
  const { lockAcquired = true, onRollupExecute } = options;
  let callCount = 0;
  const tx = {
    execute: () => {
      callCount += 1;
      if (callCount === 1) return Promise.resolve([{ acquired: lockAcquired }]);
      return onRollupExecute?.() ?? Promise.resolve([{ moved: 1 }, { moved: 1 }]);
    },
  };
  return { transaction: (fn: (t: typeof tx) => Promise<void>) => fn(tx) } as unknown as Db;
}

describe("createRollupRunner", () => {
  test("ロック取得時はロールアップを実行し、移した日次行数を報告する", async () => {
    const onResult = mock<(message: string) => void>(() => {});
    await createRollupRunner(fakeDb(), onResult).run();
    expect(onResult.mock.calls[0]?.[0]).toBe("Activity rollup completed: 2 daily rows updated");
  });

  test("advisory lockを取得できなければロールアップを呼ばずスキップする", async () => {
    const onRollupExecute = mock(() => Promise.resolve([]));
    const onResult = mock<(message: string) => void>(() => {});
    await createRollupRunner(fakeDb({ lockAcquired: false, onRollupExecute }), onResult).run();
    expect(onRollupExecute).not.toHaveBeenCalled();
    expect(onResult.mock.calls[0]?.[0]).toContain("another instance is already running");
  });

  test("失敗時はonErrorへ通知する", async () => {
    const onError = mock(() => {});
    const db = fakeDb({ onRollupExecute: () => Promise.reject(new Error("db error")) });
    await createRollupRunner(db, () => {}, onError).run();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
