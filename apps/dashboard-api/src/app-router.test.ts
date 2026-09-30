import { describe, expect, test } from "bun:test";
import { createAppRouter } from "./app-router.ts";

const appRouter = createAppRouter({
  getBotOwners: async () => [],
  collectStatus: async () => ({ checkedAt: "", summary: "ok", items: [] }),
  readLogs: async () => [],
});

describe("appRouter", () => {
  test("実装済み機能のルーターがマウントされている", () => {
    const mountedKeys = Object.keys(appRouter._def.record);
    expect(mountedKeys).toEqual(expect.arrayContaining(["activity", "logging"]));
  });

  test("moderationはrouter実装済みのため公開する(issue #175)", () => {
    const mountedKeys = Object.keys(appRouter._def.record);
    expect(mountedKeys).toContain("moderation");
  });

  test("statusはBot全体ステータス画面用に公開する(issue #507)", () => {
    expect(Object.keys(appRouter._def.record)).toContain("status");
  });

  test("tempVoiceはrouter実装済みのため公開する(issue #415)", () => {
    const mountedKeys = Object.keys(appRouter._def.record);
    expect(mountedKeys).toContain("tempVoice");
  });
});
