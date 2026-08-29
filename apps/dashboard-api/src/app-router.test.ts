import { describe, expect, test } from "bun:test";
import { appRouter } from "./app-router.ts";

describe("appRouter", () => {
  test("4機能のルーターがすべてマウントされている", () => {
    const mountedKeys = Object.keys(appRouter._def.record);
    expect(mountedKeys).toEqual(
      expect.arrayContaining(["activity", "logging", "tempVoice", "moderation"]),
    );
  });
});
