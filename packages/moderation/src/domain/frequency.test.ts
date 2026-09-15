import { describe, expect, test } from "bun:test";
import { hasFloodHit } from "./frequency.js";

describe("hasFloodHit", () => {
  const config = { windowSeconds: 10, messageThreshold: 3 };
  const now = new Date("2026-01-01T00:00:10.000Z");

  test("ウィンドウ内のメッセージ数が閾値未満ならfalse", () => {
    const timestamps = [new Date("2026-01-01T00:00:05.000Z"), new Date("2026-01-01T00:00:08.000Z")];
    expect(hasFloodHit(timestamps, now, config)).toBe(false);
  });

  test("ウィンドウ内のメッセージ数がちょうど閾値ならtrue(境界値)", () => {
    const timestamps = [
      new Date("2026-01-01T00:00:01.000Z"),
      new Date("2026-01-01T00:00:05.000Z"),
      new Date("2026-01-01T00:00:08.000Z"),
    ];
    expect(hasFloodHit(timestamps, now, config)).toBe(true);
  });

  test("ウィンドウ境界ちょうど(windowSeconds前)のタイムスタンプは含める", () => {
    const windowStart = new Date(now.getTime() - config.windowSeconds * 1000);
    const timestamps = [windowStart, new Date("2026-01-01T00:00:05.000Z"), new Date("2026-01-01T00:00:08.000Z")];
    expect(hasFloodHit(timestamps, now, config)).toBe(true);
  });

  test("ウィンドウ外(windowSecondsより過去)のタイムスタンプは含めない", () => {
    const beforeWindow = new Date(now.getTime() - config.windowSeconds * 1000 - 1);
    const timestamps = [beforeWindow, new Date("2026-01-01T00:00:05.000Z"), new Date("2026-01-01T00:00:08.000Z")];
    expect(hasFloodHit(timestamps, now, config)).toBe(false);
  });

  test("windowSecondsが0以下はRangeError", () => {
    expect(() => hasFloodHit([], now, { windowSeconds: 0, messageThreshold: 3 })).toThrow(RangeError);
  });

  test("messageThresholdが1未満はRangeError", () => {
    expect(() => hasFloodHit([], now, { windowSeconds: 10, messageThreshold: 0 })).toThrow(RangeError);
  });
});
