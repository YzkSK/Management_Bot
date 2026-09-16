import { describe, expect, test } from "bun:test";
import { findMatchingNgword, matchesNgword } from "./ngword.js";

describe("matchesNgword", () => {
  test("exactは前後空白を無視した完全一致でヒットする", () => {
    expect(matchesNgword("  ng  ", { matchType: "exact", pattern: "ng" })).toBe(true);
    expect(matchesNgword("prefix-ng", { matchType: "exact", pattern: "ng" })).toBe(false);
  });

  test("containsは部分一致でヒットする", () => {
    expect(matchesNgword("this contains ng word", { matchType: "contains", pattern: "ng word" })).toBe(true);
    expect(matchesNgword("no match here", { matchType: "contains", pattern: "ng word" })).toBe(false);
  });

  test("regexは登録済みパターンでのテストでヒットする", () => {
    expect(matchesNgword("hello123", { matchType: "regex", pattern: "^hello\\d+$" })).toBe(true);
    expect(matchesNgword("hello", { matchType: "regex", pattern: "^hello\\d+$" })).toBe(false);
  });
});

describe("findMatchingNgword", () => {
  test("最初に一致したエントリを返す", () => {
    const entries = [
      { matchType: "exact" as const, pattern: "aaa" },
      { matchType: "contains" as const, pattern: "bbb" },
    ];
    expect(findMatchingNgword("xxbbbxx", entries)).toEqual(entries[1]);
  });

  test("一致するエントリがなければnullを返す", () => {
    expect(findMatchingNgword("clean message", [{ matchType: "exact", pattern: "ng" }])).toBeNull();
  });
});
