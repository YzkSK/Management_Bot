import { describe, expect, test } from "bun:test";
import { parseRetentionDaysInput } from "./parse-retention-days.js";

describe("parseRetentionDaysInput", () => {
  test("空文字はnull(Number('')===0による誤保存を防ぐ)", () => {
    expect(parseRetentionDaysInput("")).toBeNull();
  });

  test("空白のみもnull", () => {
    expect(parseRetentionDaysInput("   ")).toBeNull();
  });

  test("0は無期限として有効", () => {
    expect(parseRetentionDaysInput("0")).toBe(0);
  });

  test("正の整数はそのまま返す", () => {
    expect(parseRetentionDaysInput("30")).toBe(30);
  });

  test("前後の空白は許容する", () => {
    expect(parseRetentionDaysInput(" 30 ")).toBe(30);
  });

  test("負の値はnull", () => {
    expect(parseRetentionDaysInput("-1")).toBeNull();
  });

  test("小数はnull", () => {
    expect(parseRetentionDaysInput("1.5")).toBeNull();
  });

  test("上限(36500)を超える値はnull", () => {
    expect(parseRetentionDaysInput("36501")).toBeNull();
  });

  test("数値でない文字列はnull", () => {
    expect(parseRetentionDaysInput("abc")).toBeNull();
  });
});
