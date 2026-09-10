import { describe, expect, test } from "bun:test";
import { appRouter } from "./app-router.ts";

describe("appRouter", () => {
  test("実装済み機能のルーターがマウントされている", () => {
    const mountedKeys = Object.keys(appRouter._def.record);
    expect(mountedKeys).toEqual(expect.arrayContaining(["activity", "logging"]));
  });

  test("moderation/temp-voiceはdomain実装が未着手のため公開しない(issue #222)", () => {
    const mountedKeys = Object.keys(appRouter._def.record);
    expect(mountedKeys).not.toContain("moderation");
    expect(mountedKeys).not.toContain("tempVoice");
  });
});
