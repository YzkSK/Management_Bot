import { describe, expect, test } from "bun:test";
import { buildLeetPattern } from "./leet-pattern.js";

describe("buildLeetPattern", () => {
  test("LEET対応表の文字を含むバリエーションにマッチする", () => {
    const pattern = buildLeetPattern("badword");
    expect(pattern.test("badword")).toBe(true);
    expect(pattern.test("b4dw0rd")).toBe(true);
    expect(pattern.test("b@dw0rd")).toBe(true);
  });

  test("対応表にない文字はそのまま扱われる", () => {
    const pattern = buildLeetPattern("キーワード");
    expect(pattern.test("キーワード")).toBe(true);
    expect(pattern.test("キーロード")).toBe(false);
  });

  test("正規表現の特殊文字はエスケープされる", () => {
    const pattern = buildLeetPattern("a.b");
    expect(pattern.test("a.b")).toBe(true);
    expect(pattern.test("axb")).toBe(false);
  });

  test("全く異なる文字列にはマッチしない", () => {
    const pattern = buildLeetPattern("badword");
    expect(pattern.test("totally different")).toBe(false);
  });
});
