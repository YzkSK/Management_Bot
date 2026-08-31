import { describe, expect, mock, test } from "bun:test";
import type { Db } from "@management-bot/db";
import { createPurgeRunner } from "./run-purge.js";

function fakeDb(settings: { guildId: string; category: string; retentionDays: number }[] = []): Db {
  return {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(settings) }),
    }),
  } as unknown as Db;
}

describe("createPurgeRunner", () => {
  test("前回実行が完了していれば通常通り実行する", async () => {
    const onResult = mock(() => {});
    const runPurge = createPurgeRunner(fakeDb(), onResult);

    await runPurge();

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0]).toContain("deleted 0 entries");
  });

  test("前回実行が完了する前に呼ばれるとスキップする(重複実行ガード)", async () => {
    const onResult = mock(() => {});
    const started = Promise.withResolvers<void>();
    const finishFirst = Promise.withResolvers<void>();
    const db = {
      select: () => ({
        from: () => ({
          where: () => {
            started.resolve();
            return finishFirst.promise.then(() => []);
          },
        }),
      }),
    } as unknown as Db;
    const runPurge = createPurgeRunner(db, onResult);

    const first = runPurge();
    await started.promise;
    await runPurge();
    finishFirst.resolve();
    await first;

    expect(onResult).toHaveBeenCalledTimes(2);
    expect(onResult.mock.calls.some((call) => call[0]?.includes("Skipping"))).toBe(true);
  });

  test("purgeExpiredLogsが失敗してもonErrorへ通知し、次回実行は妨げない", async () => {
    const onError = mock(() => {});
    const db = {
      select: () => ({
        from: () => ({ where: () => Promise.reject(new Error("db error")) }),
      }),
    } as unknown as Db;
    const runPurge = createPurgeRunner(db, () => {}, onError);

    await runPurge();
    await runPurge();

    expect(onError).toHaveBeenCalledTimes(2);
  });
});
