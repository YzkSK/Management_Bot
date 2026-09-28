import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb } from "./client.js";
import { withResourceLock } from "./advisory-lock.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);

afterAll(async () => {
  await close();
});

describe("withResourceLock", () => {
  test("同一キーへの並行呼び出しは直列化される(#410、codexレビュー指摘のTOCTOU対策)", async () => {
    const key = `test-lock-${randomUUID()}`;
    const order: string[] = [];

    const first = withResourceLock(db, key, async () => {
      order.push("first-start");
      await new Promise((resolve) => setTimeout(resolve, 200));
      order.push("first-end");
    });
    // firstが確実にロックを取得してから(タスク内に到達してから)secondを開始する。
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = withResourceLock(db, key, async () => {
      order.push("second-start");
      order.push("second-end");
    });

    await Promise.all([first, second]);

    // 直列化されていればfirst-endの後にsecond-startが来る(secondはfirstのロック解放を待つ)。
    expect(order).toEqual(["first-start", "first-end", "second-start", "second-end"]);
  });

  test("異なるキーへの呼び出しは並行実行される", async () => {
    const order: string[] = [];
    const keyA = `test-lock-a-${randomUUID()}`;
    const keyB = `test-lock-b-${randomUUID()}`;

    const a = withResourceLock(db, keyA, async () => {
      order.push("a-start");
      await new Promise((resolve) => setTimeout(resolve, 200));
      order.push("a-end");
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const b = withResourceLock(db, keyB, async () => {
      order.push("b-start");
      order.push("b-end");
    });

    await Promise.all([a, b]);

    // 異なるキーはブロックし合わないため、bはaの完了を待たずに終わる。
    expect(order.indexOf("b-end")).toBeLessThan(order.indexOf("a-end"));
  });

  test("taskが例外を投げてもロックは解放される(次の呼び出しがブロックされたままにならない)", async () => {
    const key = `test-lock-${randomUUID()}`;

    await expect(
      withResourceLock(db, key, async () => {
        throw new Error("task failed");
      }),
    ).rejects.toThrow("task failed");

    // ロックが解放されていれば、この呼び出しはブロックされずすぐ完了する。
    let ranSecond = false;
    await withResourceLock(db, key, async () => {
      ranSecond = true;
    });
    expect(ranSecond).toBe(true);
  });

  test("通常プールが枯渇していても、taskに渡されたlockedDb経由のクエリは完了する(#410、codexレビュー指摘: taskの中で元のdb(通常プール)にクエリを発行すると、多数のチャンネルが同時にロック待ちになった際、予約済みコネクションでプールの空き接続が無くなりデッドロックする)", async () => {
    // 実装が誤ってtask内で通常プール(max:1)にクエリを発行してしまう回帰が起きた場合、
    // このテストは(デフォルトタイムアウトまで)ハングするのでなく、明示的なタイムアウトで
    // 失敗として検出できるようにする。
    // max:1の小さいプールを使い、「複数チャンネルが同時にロックを取得する」状況を意図的に
    // 再現する(通常プールにも1接続しかないため、withResourceLockの実装がtask内で通常プールへ
    // クエリを発行してしまうと、2件目以降のtaskがプールの空きを待ち続けてデッドロックするはず)。
    const { db: smallPoolDb, close: closeSmallPool } = createDb(databaseUrl, { max: 1 });
    try {
      const keys = [`test-lock-pool-a-${randomUUID()}`, `test-lock-pool-b-${randomUUID()}`, `test-lock-pool-c-${randomUUID()}`];

      const results = await Promise.all(
        keys.map((key) =>
          withResourceLock(smallPoolDb, key, async (lockedDb) => {
            // lockedDb経由でクエリを発行する。通常プール(smallPoolDb)を使っていれば
            // max:1のため他のtaskとコネクションを取り合いデッドロックするはず。
            const [row] = await lockedDb.execute<{ one: number }>(sql`SELECT 1 AS one`);
            return row?.one;
          }),
        ),
      );

      expect(results).toEqual([1, 1, 1]);
    } finally {
      await closeSmallPool();
    }
  }, 10_000);
});
