import { describe, expect, test } from "bun:test";
import { canRenameWithinRateLimit } from "./rename-rate-limit.js";

describe("canRenameWithinRateLimit", () => {
  test("履歴が空なら許可する", () => {
    expect(canRenameWithinRateLimit([], Date.now())).toBe(true);
  });

  test("直近10分以内の実行が1回なら許可する", () => {
    const now = Date.now();
    expect(canRenameWithinRateLimit([now - 60_000], now)).toBe(true);
  });

  test("直近10分以内の実行が2回なら拒否する", () => {
    const now = Date.now();
    expect(canRenameWithinRateLimit([now - 60_000, now - 30_000], now)).toBe(false);
  });

  test("10分より前の実行はカウントしない", () => {
    const now = Date.now();
    const TEN_MINUTES_MS = 10 * 60 * 1000;
    expect(canRenameWithinRateLimit([now - TEN_MINUTES_MS - 1_000, now - TEN_MINUTES_MS - 500], now)).toBe(true);
  });

  test("窓内1回+窓外1回なら許可する(窓外はカウントしない)", () => {
    const now = Date.now();
    const TEN_MINUTES_MS = 10 * 60 * 1000;
    expect(canRenameWithinRateLimit([now - TEN_MINUTES_MS - 1_000, now - 60_000], now)).toBe(true);
  });
});
