import { describe, expect, test } from "bun:test";
import { isDuplicateContent, similarity } from "./duplicate-content.js";

describe("similarity", () => {
  test("完全一致は1", () => {
    expect(similarity("hello world", "hello world")).toBe(1);
  });

  test("前後空白・大文字小文字の差異は無視される", () => {
    expect(similarity("  Hello World  ", "hello world")).toBe(1);
  });

  test("両方空文字は1", () => {
    expect(similarity("", "")).toBe(1);
  });

  test("全く異なる文字列は類似度が低い", () => {
    expect(similarity("abcdef", "zzzzzz")).toBeLessThan(0.2);
  });

  test("全角/半角・連続空白の差異はNFKC正規化で無視される", () => {
    expect(similarity("Ｆｏｏ   bar", "foo bar")).toBe(1);
  });
});

describe("isDuplicateContent", () => {
  test("類似度が閾値ちょうどならヒット(境界値)", () => {
    expect(isDuplicateContent("hello world", "hello world", 1)).toBe(true);
  });

  test("類似度が閾値未満ならヒットしない", () => {
    expect(isDuplicateContent("hello world", "totally different text", 0.9)).toBe(false);
  });

  test("類似度が閾値をわずかに超える場合はヒットする", () => {
    // "hello world" (11文字) から1文字違いなので類似度は 1 - 1/11 ≈ 0.909
    expect(isDuplicateContent("hello world", "hallo world", 0.9)).toBe(true);
  });

  test("similarityThresholdが0〜1の範囲外はRangeError", () => {
    expect(() => isDuplicateContent("a", "b", -0.01)).toThrow(RangeError);
    expect(() => isDuplicateContent("a", "b", 1.01)).toThrow(RangeError);
  });
});
