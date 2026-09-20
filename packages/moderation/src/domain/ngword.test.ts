import { describe, expect, test } from "bun:test";
import { findMatchingNgword, matchesNgword } from "./ngword.js";

describe("matchesNgword", () => {
  test("exactは前後空白を無視した完全一致でヒットする", () => {
    expect(matchesNgword("  ng  ", { matchType: "exact", pattern: "ng" })).toBe(true);
    expect(matchesNgword("prefix-ng", { matchType: "exact", pattern: "ng" })).toBe(false);
  });

  test("containsは部分一致でヒットする", () => {
    expect(matchesNgword("this contains ng word", { matchType: "contains", pattern: "ngword" })).toBe(true);
    expect(matchesNgword("no match here", { matchType: "contains", pattern: "ng word" })).toBe(false);
  });

  test("regexは登録済みパターンでのテストでヒットする(正規化を挟まない)", () => {
    expect(matchesNgword("hello123", { matchType: "regex", pattern: "^hello\\d+$" })).toBe(true);
    expect(matchesNgword("hello", { matchType: "regex", pattern: "^hello\\d+$" })).toBe(false);
  });

  test("全角文字は半角化されてヒットする", () => {
    expect(matchesNgword("ＢＡＤＷＯＲＤ", { matchType: "contains", pattern: "badword" })).toBe(true);
  });

  test("ゼロ幅文字を挿入した回避はヒットする", () => {
    expect(matchesNgword("b​a‌d‍w﻿ord", { matchType: "contains", pattern: "badword" })).toBe(true);
  });

  test("記号で分割した回避はヒットする", () => {
    expect(matchesNgword("b.a.d.w.o.r.d", { matchType: "contains", pattern: "badword" })).toBe(true);
  });

  test("LEET表現による回避はヒットする", () => {
    expect(matchesNgword("b@dw0rd", { matchType: "contains", pattern: "badword" })).toBe(true);
    expect(matchesNgword("b4dw0rd", { matchType: "contains", pattern: "badword" })).toBe(true);
  });

  test("カタカナ・ひらがな混在のNGワードは通常通りcontainsマッチする", () => {
    expect(matchesNgword("キーワード", { matchType: "contains", pattern: "キーワード" })).toBe(true);
  });

  test("通常の数字列やURLは過剰検知されない", () => {
    expect(matchesNgword("12345", { matchType: "contains", pattern: "badword" })).toBe(false);
    expect(matchesNgword("https://example.com/path", { matchType: "contains", pattern: "badword" })).toBe(false);
  });

  test("空文字・記号のみのパターンは誤検知しない", () => {
    expect(matchesNgword("hello world", { matchType: "contains", pattern: "..." })).toBe(false);
    expect(matchesNgword("hello world", { matchType: "contains", pattern: "" })).toBe(false);
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
