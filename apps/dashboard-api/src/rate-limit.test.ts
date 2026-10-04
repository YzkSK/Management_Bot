import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createRateLimiter, rateLimit } from "./rate-limit.js";

describe("createRateLimiter", () => {
  test("ウィンドウ内で上限を超えたらfalse、ウィンドウが明けたら再びtrue", () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
    expect(limiter.hit("a")).toBe(true);
    expect(limiter.hit("a")).toBe(true);
    expect(limiter.hit("a")).toBe(false);
    expect(limiter.hit("b")).toBe(true);
    t = 1000;
    expect(limiter.hit("a")).toBe(true);
  });
});

describe("rateLimit middleware", () => {
  const appWith = (limit: number, filter?: (method: string) => boolean) => {
    const app = new Hono();
    app.use("*", rateLimit(createRateLimiter({ limit, windowMs: 60_000 }), filter));
    app.all("*", (c) => c.text("ok"));
    return app;
  };

  test("上限を超えたら429を返し、セッションCookieを変えても回避できない", async () => {
    const app = appWith(1);
    const ip = { "X-Forwarded-For": "1.1.1.1" };
    expect((await app.request("/x", { headers: { ...ip, cookie: "session_id=s1" } })).status).toBe(200);
    expect((await app.request("/x", { headers: { ...ip, cookie: "session_id=s2" } })).status).toBe(429);
    expect((await app.request("/x", { headers: { "X-Forwarded-For": "2.2.2.2" } })).status).toBe(200);
  });

  test("X-Forwarded-Forの末尾(プロキシが見た接続元)で数え、先頭の偽装値では回避できない", async () => {
    const app = appWith(1);
    expect((await app.request("/x", { headers: { "X-Forwarded-For": "1.1.1.1, 9.9.9.9" } })).status).toBe(200);
    expect((await app.request("/x", { headers: { "X-Forwarded-For": "2.2.2.2, 9.9.9.9" } })).status).toBe(429);
  });

  test("filterに一致しないメソッドは数えない", async () => {
    const app = appWith(1, (method) => method === "POST");
    expect((await app.request("/x")).status).toBe(200);
    expect((await app.request("/x")).status).toBe(200);
    expect((await app.request("/x", { method: "POST" })).status).toBe(200);
    expect((await app.request("/x", { method: "POST" })).status).toBe(429);
  });
});
