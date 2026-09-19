import { describe, expect, test } from "bun:test";
import { isNewAccount } from "./new-account-guard.js";

describe("isNewAccount", () => {
  const maxAgeDays = 7;

  test("returns true through the inclusive maximum age", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    expect(isNewAccount(createdAt, new Date("2026-01-08T00:00:00.000Z"), maxAgeDays)).toBe(true);
  });

  test("rejects accounts older than the maximum age and future creation times", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    expect(isNewAccount(createdAt, new Date("2026-01-08T00:00:00.001Z"), maxAgeDays)).toBe(false);
    expect(isNewAccount(new Date("2026-01-05T00:00:00.000Z"), createdAt, maxAgeDays)).toBe(false);
  });

  test("rejects negative maximum ages", () => {
    expect(() => isNewAccount(new Date(), new Date(), -1)).toThrow(RangeError);
  });
});
