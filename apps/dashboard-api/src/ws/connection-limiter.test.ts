import { describe, expect, test } from "bun:test";
import { createConnectionLimiter } from "./connection-limiter.js";

describe("createConnectionLimiter", () => {
  test("ユーザー単位の上限を超えた接続は拒否し、解放後は再び受け付ける", () => {
    const limiter = createConnectionLimiter({ perUser: 2, total: 10 });
    expect(limiter.tryAcquire("u1")).toBe(true);
    expect(limiter.tryAcquire("u1")).toBe(true);
    expect(limiter.tryAcquire("u1")).toBe(false);
    expect(limiter.tryAcquire("u2")).toBe(true);
    limiter.release("u1");
    expect(limiter.tryAcquire("u1")).toBe(true);
  });

  test("全体の上限を超えた接続は別ユーザーでも拒否する", () => {
    const limiter = createConnectionLimiter({ perUser: 5, total: 2 });
    expect(limiter.tryAcquire("u1")).toBe(true);
    expect(limiter.tryAcquire("u2")).toBe(true);
    expect(limiter.tryAcquire("u3")).toBe(false);
    limiter.release("u2");
    expect(limiter.tryAcquire("u3")).toBe(true);
  });

  test("未取得のユーザーをreleaseしても全体数は減らない", () => {
    const limiter = createConnectionLimiter({ perUser: 5, total: 1 });
    limiter.release("ghost");
    expect(limiter.tryAcquire("u1")).toBe(true);
    expect(limiter.tryAcquire("u2")).toBe(false);
  });
});
