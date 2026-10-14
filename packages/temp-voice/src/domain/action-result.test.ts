import { describe, expect, test } from "bun:test";
import { parseTempVoiceActionResult, serializeTempVoiceActionResult, tempVoiceActionResultKey } from "./action-result.js";

describe("tempVoiceActionResult", () => {
  test("キーはギルド単位", () => {
    expect(tempVoiceActionResultKey("g1", "r1")).toBe("temp-voice:action-result:g1:r1");
  });

  test("シリアライズ→パースで元に戻る", () => {
    for (const result of [{ ok: true }, { ok: false, reason: "rate_limited" }] as const) {
      expect(parseTempVoiceActionResult(serializeTempVoiceActionResult(result))).toEqual(result);
    }
  });

  test("不正な値・未書き込みはundefined", () => {
    expect(parseTempVoiceActionResult(undefined)).toBeUndefined();
    expect(parseTempVoiceActionResult("not json")).toBeUndefined();
    expect(parseTempVoiceActionResult(JSON.stringify({ ok: false, reason: "unknown" }))).toBeUndefined();
    expect(parseTempVoiceActionResult(JSON.stringify({ ok: false }))).toBeUndefined();
  });
});
