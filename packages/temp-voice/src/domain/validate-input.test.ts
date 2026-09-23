import { describe, expect, test } from "bun:test";
import { validateBitrateKbps, validateChannelName, validateUserLimit } from "./validate-input.js";

describe("validateChannelName", () => {
  test("通常の文字列は許可する(前後空白はtrimする)", () => {
    const result = validateChannelName("  太郎のVC  ");
    expect(result).toEqual({ ok: true, value: "太郎のVC" });
  });

  test("空文字は拒否する", () => {
    expect(validateChannelName("").ok).toBe(false);
  });

  test("空白のみは拒否する", () => {
    expect(validateChannelName("   ").ok).toBe(false);
  });

  test("100文字ちょうどは許可する", () => {
    expect(validateChannelName("a".repeat(100)).ok).toBe(true);
  });

  test("101文字は拒否する", () => {
    expect(validateChannelName("a".repeat(101)).ok).toBe(false);
  });
});

describe("validateUserLimit", () => {
  test("0(無制限)は許可する", () => {
    expect(validateUserLimit("0")).toEqual({ ok: true, value: 0 });
  });

  test("99は許可する", () => {
    expect(validateUserLimit("99")).toEqual({ ok: true, value: 99 });
  });

  test("100は拒否する", () => {
    expect(validateUserLimit("100").ok).toBe(false);
  });

  test("負の値は拒否する", () => {
    expect(validateUserLimit("-1").ok).toBe(false);
  });

  test("数値でない文字列は拒否する", () => {
    expect(validateUserLimit("abc").ok).toBe(false);
  });

  test("小数は拒否する", () => {
    expect(validateUserLimit("5.5").ok).toBe(false);
  });

  test("空白のみの入力は拒否する(Number('')===0による無制限への誤変換を防ぐ)", () => {
    expect(validateUserLimit("   ").ok).toBe(false);
  });
});

describe("validateBitrateKbps", () => {
  test("上限内の値はbps単位に変換して許可する", () => {
    expect(validateBitrateKbps("96", 128_000)).toEqual({ ok: true, value: 96_000 });
  });

  test("上限ちょうどは許可する", () => {
    expect(validateBitrateKbps("128", 128_000)).toEqual({ ok: true, value: 128_000 });
  });

  test("上限超過は拒否し上限値をメッセージに含める", () => {
    const result = validateBitrateKbps("256", 128_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("128kbps");
  });

  test("0以下は拒否する", () => {
    expect(validateBitrateKbps("0", 128_000).ok).toBe(false);
  });

  test("8kbps未満(Discordの下限未満)は拒否する", () => {
    expect(validateBitrateKbps("7", 128_000).ok).toBe(false);
  });

  test("8kbpsちょうどは許可する", () => {
    expect(validateBitrateKbps("8", 128_000)).toEqual({ ok: true, value: 8_000 });
  });

  test("数値でない文字列は拒否する", () => {
    expect(validateBitrateKbps("abc", 128_000).ok).toBe(false);
  });

  test("空白のみの入力は拒否する", () => {
    expect(validateBitrateKbps("   ", 128_000).ok).toBe(false);
  });
});
