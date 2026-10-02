import { describe, expect, test } from "bun:test";
import { fillSeries, formatBucketLabel, formatDuration, formatRelative, toRange } from "./activity-range.js";

const now = new Date("2026-09-29T12:34:56.000Z");

describe("toRange", () => {
  test("今日(24h)は日本時間の0時からの時間別、それ以外は日別", () => {
    expect(toRange("24h", now)).toEqual({
      from: "2026-09-28T15:00:00.000Z",
      to: "2026-09-29T12:34:56.000Z",
      granularity: "hour",
    });
    expect(toRange("7d", now)).toEqual({
      from: "2026-09-22T12:34:56.000Z",
      to: "2026-09-29T12:34:56.000Z",
      granularity: "day",
    });
    expect(toRange("90d", now).from).toBe("2026-07-01T12:34:56.000Z");
  });
});

describe("fillSeries", () => {
  test("日別はJSTの各日を0で補完する", () => {
    const range = toRange("7d", now);
    const filled = fillSeries([{ bucket: "2026-09-25", messageCount: 3, voiceSeconds: 60 }], range);
    expect(filled.map((p) => p.bucket)).toEqual([
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
      "2026-09-28",
      "2026-09-29",
    ]);
    expect(filled[3]).toEqual({ bucket: "2026-09-25", messageCount: 3, voiceSeconds: 60 });
    expect(filled[0]).toEqual({ bucket: "2026-09-22", messageCount: 0, voiceSeconds: 0 });
  });

  test("時間別は当日の0時〜23時の24本を0で補完する", () => {
    const filled = fillSeries([], toRange("24h", now));
    expect(filled).toHaveLength(24);
    expect(filled.map((p) => formatBucketLabel(p.bucket, "hour"))).toEqual(Array.from({ length: 24 }, (_, h) => `${h}時`));
  });
});

describe("formatDuration", () => {
  test("時間と分で表す", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(20 * 60)).toBe("20m");
    expect(formatDuration(14 * 3600 + 20 * 60)).toBe("14h 20m");
  });
});

describe("formatBucketLabel / formatRelative", () => {
  test("日別はMM/DD、時間別はJSTの時", () => {
    expect(formatBucketLabel("2026-09-29", "day")).toBe("09/29");
    expect(formatBucketLabel("2026-09-29T15:00:00.000Z", "hour")).toBe("0時");
  });

  test("最終活動を相対表示する", () => {
    expect(formatRelative(null, now)).toBe("-");
    expect(formatRelative("2026-09-29T12:00:00.000Z", now)).toBe("34分前");
    expect(formatRelative("2026-09-29T09:00:00.000Z", now)).toBe("3時間前");
    expect(formatRelative("2026-09-27T12:00:00.000Z", now)).toBe("2日前");
  });
});
