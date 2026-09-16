import { describe, expect, test } from "bun:test";
import { checkRegexSafety } from "./regex-safety.js";

describe("checkRegexSafety", () => {
  test("安全な単純パターンはsafe: trueを返す", () => {
    expect(checkRegexSafety("^hello\\d+$")).toEqual({ safe: true });
    expect(checkRegexSafety("foo|bar|baz")).toEqual({ safe: true });
  });

  test("構文エラーのパターンはsafe: falseを返す", () => {
    const result = checkRegexSafety("(unclosed");
    expect(result.safe).toBe(false);
    expect(result.reason).toBeDefined();
  });

  test("ネストした量指定子(a+)+はsafe: falseを返す", () => {
    expect(checkRegexSafety("(a+)+").safe).toBe(false);
  });

  test("ネストした量指定子(a*)*はsafe: falseを返す", () => {
    expect(checkRegexSafety("(a*)*").safe).toBe(false);
  });

  test("量指定子付きグループの{n,}形式もsafe: falseを返す", () => {
    expect(checkRegexSafety("(a{2,})+").safe).toBe(false);
  });

  test("曖昧な選択の繰り返し(a|a)*はsafe: falseを返す", () => {
    expect(checkRegexSafety("(a|a)*").safe).toBe(false);
  });
});
