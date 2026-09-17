import { describe, expect, test } from "bun:test";
import {
  decideRaidSeverity,
  detectRaid,
  entriesInWindow,
  hasRaidHit,
  newAccountRatio,
  type RaidBufferEntry,
} from "./raid.js";

function entry(userId: string, joinedAt: string, isNewAccount = false): RaidBufferEntry {
  return { userId, joinedAt: new Date(joinedAt), isNewAccount };
}

describe("entriesInWindow", () => {
  const now = new Date("2026-01-01T00:00:30.000Z");
  const windowSeconds = 30;

  test("ウィンドウ内の入室のみ抽出する", () => {
    const buffer = [
      entry("u1", "2026-01-01T00:00:00.000Z"),
      entry("u2", "2025-12-31T23:59:59.000Z"),
      entry("u3", "2026-01-01T00:00:29.000Z"),
    ];
    const result = entriesInWindow(buffer, now, windowSeconds);
    expect(result.map((e) => e.userId)).toEqual(["u1", "u3"]);
  });

  test("ウィンドウ境界ちょうど(windowSeconds前)は含める", () => {
    const windowStart = new Date(now.getTime() - windowSeconds * 1000);
    const buffer = [{ userId: "u1", joinedAt: windowStart, isNewAccount: false }];
    expect(entriesInWindow(buffer, now, windowSeconds)).toHaveLength(1);
  });
});

describe("hasRaidHit", () => {
  test("人数が閾値未満ならfalse", () => {
    const entries = [entry("u1", "2026-01-01T00:00:00.000Z"), entry("u2", "2026-01-01T00:00:01.000Z")];
    expect(hasRaidHit(entries, 3)).toBe(false);
  });

  test("人数がちょうど閾値ならtrue(境界値)", () => {
    const entries = [
      entry("u1", "2026-01-01T00:00:00.000Z"),
      entry("u2", "2026-01-01T00:00:01.000Z"),
      entry("u3", "2026-01-01T00:00:02.000Z"),
    ];
    expect(hasRaidHit(entries, 3)).toBe(true);
  });

  test("memberThresholdが1未満はRangeError", () => {
    expect(() => hasRaidHit([], 0)).toThrow(RangeError);
  });
});

describe("newAccountRatio", () => {
  test("空配列は0", () => {
    expect(newAccountRatio([])).toBe(0);
  });

  test("新規アカウント数/全体数を返す", () => {
    const entries = [
      entry("u1", "2026-01-01T00:00:00.000Z", true),
      entry("u2", "2026-01-01T00:00:00.000Z", true),
      entry("u3", "2026-01-01T00:00:00.000Z", false),
      entry("u4", "2026-01-01T00:00:00.000Z", false),
    ];
    expect(newAccountRatio(entries)).toBe(0.5);
  });
});

describe("decideRaidSeverity", () => {
  test("比率が閾値未満ならnormal", () => {
    expect(decideRaidSeverity(0.5, 0.6)).toBe("normal");
  });

  test("比率がちょうど閾値ならhigh(境界値)", () => {
    expect(decideRaidSeverity(0.6, 0.6)).toBe("high");
  });

  test("比率が閾値超ならhigh", () => {
    expect(decideRaidSeverity(0.9, 0.6)).toBe("high");
  });
});

describe("detectRaid", () => {
  const now = new Date("2026-01-01T00:00:30.000Z");
  const config = {
    window: { windowSeconds: 30, memberThreshold: 3 },
    newAccountMaxAgeDays: 7,
    newAccountRatioThreshold: 0.6,
  };

  test("ヒットしない場合はtargetUserIdsが空でseverity=normal", () => {
    const buffer = [entry("u1", "2026-01-01T00:00:00.000Z"), entry("u2", "2026-01-01T00:00:01.000Z")];
    const result = detectRaid(buffer, now, config);
    expect(result).toEqual({ hit: false, targetUserIds: [], severity: "normal" });
  });

  test("ヒット時、新規アカウント比率が閾値未満ならseverity=normal", () => {
    const buffer = [
      entry("u1", "2026-01-01T00:00:00.000Z", true),
      entry("u2", "2026-01-01T00:00:01.000Z", false),
      entry("u3", "2026-01-01T00:00:02.000Z", false),
    ];
    const result = detectRaid(buffer, now, config);
    expect(result.hit).toBe(true);
    expect(result.severity).toBe("normal");
    expect(result.targetUserIds).toEqual(["u1", "u2", "u3"]);
  });

  test("ヒット時、新規アカウント比率が閾値以上ならseverity=high", () => {
    const buffer = [
      entry("u1", "2026-01-01T00:00:00.000Z", true),
      entry("u2", "2026-01-01T00:00:01.000Z", true),
      entry("u3", "2026-01-01T00:00:02.000Z", false),
    ];
    const result = detectRaid(buffer, now, config);
    expect(result.hit).toBe(true);
    expect(result.severity).toBe("high");
  });

  test("ウィンドウ外の入室者は人数判定・比率判定の両方から除外される", () => {
    const buffer = [
      entry("u1", "2026-01-01T00:00:00.000Z", true),
      entry("u2", "2026-01-01T00:00:01.000Z", true),
      entry("u3", "2025-12-31T23:00:00.000Z", true),
    ];
    const result = detectRaid(buffer, now, config);
    expect(result.hit).toBe(false);
  });
});
