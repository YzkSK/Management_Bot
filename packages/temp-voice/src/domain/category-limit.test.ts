import { describe, expect, test } from "bun:test";
import { canCreateTempVoiceInCategory } from "./category-limit.js";

describe("canCreateTempVoiceInCategory", () => {
  test("0チャンネルなら作成できる", () => {
    expect(canCreateTempVoiceInCategory(0)).toBe(true);
  });

  test("48チャンネル(24組)なら新規1組を作成できる(48+2=50)", () => {
    expect(canCreateTempVoiceInCategory(48)).toBe(true);
  });

  test("49チャンネルなら新規1組は作成できない(49+2=51>50)", () => {
    expect(canCreateTempVoiceInCategory(49)).toBe(false);
  });

  test("50チャンネル(上限到達済み)なら作成できない", () => {
    expect(canCreateTempVoiceInCategory(50)).toBe(false);
  });
});
