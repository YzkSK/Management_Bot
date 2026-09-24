import { describe, expect, test } from "bun:test";
import { appRouter } from "./app-router.ts";

describe("appRouter", () => {
  test("実装済み機能のルーターがマウントされている", () => {
    const mountedKeys = Object.keys(appRouter._def.record);
    expect(mountedKeys).toEqual(expect.arrayContaining(["activity", "logging"]));
  });

  test("moderationはrouter実装済みのため公開する(issue #175)", () => {
    const mountedKeys = Object.keys(appRouter._def.record);
    expect(mountedKeys).toContain("moderation");
  });

  test("tempVoiceはrouter実装済みのため公開する(issue #415)", () => {
    const mountedKeys = Object.keys(appRouter._def.record);
    expect(mountedKeys).toContain("tempVoice");
  });
});
