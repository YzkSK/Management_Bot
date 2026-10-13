import { describe, expect, test } from "bun:test";
import { formatDayHeading, formatTime, groupByDay } from "./day-groups.js";

const now = new Date(2026, 9, 12, 15, 0);

describe("day-groups", () => {
  test("日付見出しは今日・昨日・明日を相対表記し、「10月12日(月)」形式にする", () => {
    expect(formatDayHeading(new Date(2026, 9, 12, 1), now)).toMatchObject({ relative: "今日", date: "10月12日(月)" });
    expect(formatDayHeading(new Date(2026, 9, 11, 23), now)).toMatchObject({ relative: "昨日", date: "10月11日(日)" });
    expect(formatDayHeading(new Date(2026, 9, 13, 9), now)).toMatchObject({ relative: "明日", date: "10月13日(火)" });
    expect(formatDayHeading(new Date(2026, 9, 1), now)).toMatchObject({ relative: null, date: "10月1日(木)" });
    expect(formatDayHeading(new Date(2025, 11, 31), now).date).toBe("2025年12月31日(水)");
  });

  test("groupByDayは連続する同じ日付をまとめる", () => {
    const items = [
      { id: "a", at: new Date(2026, 9, 12, 14) },
      { id: "b", at: new Date(2026, 9, 12, 9) },
      { id: "c", at: new Date(2026, 9, 11, 22) },
    ];
    const groups = groupByDay(items, (item) => item.at, now);
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([["a", "b"], ["c"]]);
    expect(groups.map((g) => g.relative)).toEqual(["今日", "昨日"]);
  });

  test("formatTimeはHH:mm", () => {
    expect(formatTime(new Date(2026, 9, 12, 9, 5))).toBe("09:05");
  });
});
