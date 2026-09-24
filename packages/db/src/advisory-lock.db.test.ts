import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
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
});
