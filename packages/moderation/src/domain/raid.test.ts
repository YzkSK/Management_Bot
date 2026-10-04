import { describe, expect, test } from "bun:test";
import { RAID_PRESETS } from "./presets.js";
import {
  decideRaidSeverity,
  detectRaid,
  entriesInWindow,
  escalateSeverityByIncidentCount,
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

describe("escalateSeverityByIncidentCount", () => {
  test("priorIncidentCount=0(初回)なら元のseverityを維持する", () => {
    expect(escalateSeverityByIncidentCount("normal", 0)).toBe("normal");
    expect(escalateSeverityByIncidentCount("high", 0)).toBe("high");
  });

  test("priorIncidentCount=1(2回目以降)ならnormalをhighへ引き上げる(境界値)", () => {
    expect(escalateSeverityByIncidentCount("normal", 1)).toBe("high");
  });

  test("priorIncidentCountが閾値超でもhighを維持する", () => {
    expect(escalateSeverityByIncidentCount("normal", 5)).toBe("high");
  });
});

describe("detectRaid", () => {
  const now = new Date("2026-01-01T00:00:30.000Z");
  const config = {
    window: { windowSeconds: 30, memberThreshold: 3 },
    longWindow: { windowSeconds: 300, memberThreshold: 10 },
    newAccountMaxAgeDays: 7,
    newAccountRatioThreshold: 0.6,
  };

  test("ヒットしない場合はtargetUserIdsが空でseverity=normal", () => {
    const buffer = [entry("u1", "2026-01-01T00:00:00.000Z"), entry("u2", "2026-01-01T00:00:01.000Z")];
    const result = detectRaid(buffer, now, config);
    expect(result).toEqual({ hit: false, targetUserIds: [], severity: "normal", windowSeconds: 30 });
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

// 多段スライディングウィンドウ(#566)の代表的な回避パターン。medium presetの値を使う。
describe("detectRaid: 多段ウィンドウと回避パターン", () => {
  const config = RAID_PRESETS.medium;
  const shortW = config.window;
  const longW = config.longWindow;
  const base = new Date("2026-01-01T00:00:00.000Z").getTime();

  function joins(count: number, atMs: (i: number) => number, isNewAccount = false): RaidBufferEntry[] {
    return Array.from({ length: count }, (_, i) => ({
      userId: `u${i}`,
      joinedAt: new Date(base + atMs(i)),
      isNewAccount,
    }));
  }

  function lastJoinedAt(buffer: readonly RaidBufferEntry[]): Date {
    return new Date(Math.max(...buffer.map((e) => e.joinedAt.getTime())));
  }

  test("短期ウィンドウ内にしきい値ちょうどのバーストはヒットする", () => {
    const buffer = joins(shortW.memberThreshold, (i) => i * 1000);
    const result = detectRaid(buffer, lastJoinedAt(buffer), config);
    expect(result.hit).toBe(true);
    expect(result.windowSeconds).toBe(shortW.windowSeconds);
  });

  test("しきい値-1人を短期ウィンドウより少し長い間隔で5分間続けると長期ウィンドウでヒットする", () => {
    const perBatch = shortW.memberThreshold - 1;
    const periodMs = (shortW.windowSeconds + 1) * 1000;
    const batches = Math.floor((longW.windowSeconds * 1000) / periodMs);
    const buffer = joins(perBatch * batches, (i) => Math.floor(i / perBatch) * periodMs + (i % perBatch) * 1000);
    const now = lastJoinedAt(buffer);
    // 前提: どの時点でも短期ウィンドウ単独ではヒットしない。
    expect(hasRaidHit(entriesInWindow(buffer, now, shortW.windowSeconds), shortW.memberThreshold)).toBe(false);
    const result = detectRaid(buffer, now, config);
    expect(result.hit).toBe(true);
    expect(result.windowSeconds).toBe(longW.windowSeconds);
    expect(result.targetUserIds).toHaveLength(buffer.length);
  });

  test("短期しきい値未満のバーストで長期しきい値にも届かなければヒットしない", () => {
    const buffer = joins(shortW.memberThreshold - 1, (i) => i * 1000);
    const result = detectRaid(buffer, lastJoinedAt(buffer), config);
    expect(result.hit).toBe(false);
  });

  test("長期ウィンドウ内の人数が常にしきい値未満になる間隔で入室すると検知できない(限界)", () => {
    // 長期ウィンドウ内に高々(しきい値-1)人しか入らない間隔(閉区間のため+1ms)。
    const intervalMs = Math.floor((longW.windowSeconds * 1000) / (longW.memberThreshold - 1)) + 1;
    const buffer = joins(longW.memberThreshold * 3, (i) => i * intervalMs);
    const result = detectRaid(buffer, lastJoinedAt(buffer), config);
    expect(result.hit).toBe(false);
  });

  test("アカウントが古い入室者でもしきい値到達でヒットし、severityはnormal", () => {
    const buffer = joins(shortW.memberThreshold, (i) => i * 1000, false);
    const result = detectRaid(buffer, lastJoinedAt(buffer), config);
    expect(result.hit).toBe(true);
    expect(result.severity).toBe("normal");
  });

  test("新規アカウントばかりならしきい値到達でseverityはhigh", () => {
    const buffer = joins(shortW.memberThreshold, (i) => i * 1000, true);
    const result = detectRaid(buffer, lastJoinedAt(buffer), config);
    expect(result.hit).toBe(true);
    expect(result.severity).toBe("high");
  });
});
