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

  test("temp-voiceはdomain実装が未着手のため公開しない(issue #222)", () => {
    const mountedKeys = Object.keys(appRouter._def.record);
    expect(mountedKeys).not.toContain("tempVoice");
  });
});
