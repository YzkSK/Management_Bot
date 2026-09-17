import { describe, expect, test } from "bun:test";
import { hasNewAccountGuardHit, isNewAccount } from "./new-account-guard.js";

describe("isNewAccount", () => {
  const maxAgeDays = 7;

  test("作成からmaxAgeDaysより新しければtrue", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const joinedAt = new Date("2026-01-05T00:00:00.000Z");
    expect(isNewAccount(createdAt, joinedAt, maxAgeDays)).toBe(true);
  });

  test("作成からちょうどmaxAgeDaysならtrue(境界値)", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const joinedAt = new Date("2026-01-08T00:00:00.000Z");
    expect(isNewAccount(createdAt, joinedAt, maxAgeDays)).toBe(true);
  });

  test("作成からmaxAgeDaysより古ければfalse", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const joinedAt = new Date("2026-01-08T00:00:00.001Z");
    expect(isNewAccount(createdAt, joinedAt, maxAgeDays)).toBe(false);
  });

  test("joinedAtがcreatedAtより前(クロックスキュー等)はfalse", () => {
    const createdAt = new Date("2026-01-05T00:00:00.000Z");
    const joinedAt = new Date("2026-01-01T00:00:00.000Z");
    expect(isNewAccount(createdAt, joinedAt, maxAgeDays)).toBe(false);
  });

  test("maxAgeDaysが負数はRangeError", () => {
    expect(() => isNewAccount(new Date(), new Date(), -1)).toThrow(RangeError);
  });
});

describe("hasNewAccountGuardHit", () => {
  test("isNewAccountと同じ結果を返す", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const joinedAt = new Date("2026-01-02T00:00:00.000Z");
    expect(hasNewAccountGuardHit(createdAt, joinedAt, 3)).toBe(true);
    expect(hasNewAccountGuardHit(createdAt, joinedAt, 0)).toBe(false);
  });
});
