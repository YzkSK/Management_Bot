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

  test("外側の量指定子が{n,}形式のネストパターン^(a+){1,}$もsafe: falseを返す(Codexレビュー指摘)", () => {
    expect(checkRegexSafety("^(a+){1,}$").safe).toBe(false);
  });

  test("外側の量指定子が{n,m}形式のネストパターンもsafe: falseを返す", () => {
    expect(checkRegexSafety("(a+){1,5}").safe).toBe(false);
  });

  test("内側の量指定子が{n,m}形式のネストパターン^(a{1,5}){1,}$もsafe: falseを返す(Codexレビュー指摘の回帰テスト)", () => {
    expect(checkRegexSafety("^(a{1,5}){1,}$").safe).toBe(false);
  });

  test("曖昧な選択の繰り返し(a|a)*はsafe: falseを返す", () => {
    expect(checkRegexSafety("(a|a)*").safe).toBe(false);
  });

  test.each(["((a+))+", "((a|b))*", "(.*a){25}", "(?:a+)+", "(a+){2}", "[](a+)+", "[^](a+)+"])(
    "二重括弧・{n}形式・非捕捉グループを含む危険パターン%sはsafe: falseを返す",
    (pattern) => {
      expect(checkRegexSafety(pattern).safe).toBe(false);
    },
  );

  test.each(["(abc){3}", "(?:foo)+", "colou?r", "(ab)?", "[(a+)]+", "\\(a+\\)+", "a{2,5}b", "foo|bar|baz", "(foo|bar)?"])(
    "安全なパターン%sはsafe: trueを返す",
    (pattern) => {
      expect(checkRegexSafety(pattern)).toEqual({ safe: true });
    },
  );
});
