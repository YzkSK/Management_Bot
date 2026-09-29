import { describe, expect, test } from "bun:test";
import { KeyedQueue } from "./keyed-queue.js";

describe("KeyedQueue", () => {
  test("同じキーの処理は前の処理の完了を待ってから実行する(遅い更新の後に退室が追い越さない)", async () => {
    const queue = new KeyedQueue();
    const log: string[] = [];
    let releaseUpdate = () => {};
    const update = queue.run("g:u", async () => {
      await new Promise<void>((resolve) => (releaseUpdate = resolve));
      log.push("update");
    });
    const leave = queue.run("g:u", async () => {
      log.push("leave");
    });
    await Promise.resolve();
    expect(log).toEqual([]);
    releaseUpdate();
    await Promise.all([update, leave]);
    expect(log).toEqual(["update", "leave"]);
  });

  test("前の処理が失敗しても後続は実行し、失敗は呼び出し元へ返す", async () => {
    const queue = new KeyedQueue();
    const failed = queue.run("k", async () => {
      throw new Error("boom");
    });
    const next = queue.run("k", async () => "ok");
    expect(await failed.catch((e: unknown) => e instanceof Error && e.message)).toBe("boom");
    expect(await next).toBe("ok");
  });

  test("別キーは並行に実行する", async () => {
    const queue = new KeyedQueue();
    const log: string[] = [];
    let release = () => {};
    const slow = queue.run("a", () => new Promise<void>((resolve) => (release = resolve)));
    await queue.run("b", async () => {
      log.push("b");
    });
    expect(log).toEqual(["b"]);
    release();
    await slow;
  });
});
