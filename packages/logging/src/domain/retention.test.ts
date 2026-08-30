import { describe, expect, test } from "bun:test";
import { isExpired } from "./retention.js";

describe("isExpired", () => {
  test("retentionDays=0は常にfalse(無期限保存)", () => {
    const veryOld = new Date("2000-01-01T00:00:00Z");
    expect(isExpired(0, veryOld, new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });

  test("保持期間内はfalse", () => {
    const createdAt = new Date("2026-08-25T00:00:00Z");
    const now = new Date("2026-08-27T00:00:00Z");
    expect(isExpired(30, createdAt, now)).toBe(false);
  });

  test("保持期間を過ぎるとtrue", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-02-01T00:00:00Z");
    expect(isExpired(30, createdAt, now)).toBe(true);
  });

  test("境界値: ちょうど保持期間経過時点でtrue", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-08T00:00:00Z");
    expect(isExpired(7, createdAt, now)).toBe(true);
  });

  test("境界値: 保持期間経過の1ms手前はfalse", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-07T23:59:59.999Z");
    expect(isExpired(7, createdAt, now)).toBe(false);
  });

  test("負値はRangeError", () => {
    expect(() => isExpired(-1, new Date(), new Date())).toThrow(RangeError);
  });

  test("非整数はRangeError", () => {
    expect(() => isExpired(1.5, new Date(), new Date())).toThrow(RangeError);
  });

  test("不正なcreatedAt(Invalid Date)はRangeError", () => {
    expect(() => isExpired(30, new Date("not-a-date"), new Date())).toThrow(RangeError);
  });

  test("不正なnow(Invalid Date)はRangeError", () => {
    expect(() => isExpired(30, new Date(), new Date("not-a-date"))).toThrow(RangeError);
  });
});
