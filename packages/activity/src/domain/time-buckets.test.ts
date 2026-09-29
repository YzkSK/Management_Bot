import { describe, expect, test } from "bun:test";
import { hourStart, splitIntoHours, toJstDay } from "./time-buckets.js";

const t = (iso: string) => new Date(iso);

describe("splitIntoHours", () => {
  test("同じ時間内なら1バケット", () => {
    expect(splitIntoHours(t("2026-09-29T10:10:00Z"), t("2026-09-29T10:40:30Z"))).toEqual([
      { hour: t("2026-09-29T10:00:00Z"), seconds: 1830 },
    ]);
  });

  test("時間境界をまたぐと分割する", () => {
    expect(splitIntoHours(t("2026-09-29T14:50:00Z"), t("2026-09-29T16:20:00Z"))).toEqual([
      { hour: t("2026-09-29T14:00:00Z"), seconds: 600 },
      { hour: t("2026-09-29T15:00:00Z"), seconds: 3600 },
      { hour: t("2026-09-29T16:00:00Z"), seconds: 1200 },
    ]);
  });

  test("end<=startなら空", () => {
    expect(splitIntoHours(t("2026-09-29T10:00:00Z"), t("2026-09-29T10:00:00Z"))).toEqual([]);
    expect(splitIntoHours(t("2026-09-29T10:00:05Z"), t("2026-09-29T10:00:00Z"))).toEqual([]);
  });

  test("ミリ秒の端数で0秒になるバケットは返さない", () => {
    expect(splitIntoHours(t("2026-09-29T10:59:59.600Z"), t("2026-09-29T11:00:00.400Z"))).toEqual([
      { hour: t("2026-09-29T10:00:00Z"), seconds: 1 },
    ]);
  });
});

describe("hourStart / toJstDay", () => {
  test("hourStartは分秒ミリ秒を0にする", () => {
    expect(hourStart(t("2026-09-29T10:59:59.999Z"))).toEqual(t("2026-09-29T10:00:00Z"));
  });

  test("toJstDayはUTC15時以降を翌日にする", () => {
    expect(toJstDay(t("2026-09-29T14:59:59Z"))).toBe("2026-09-29");
    expect(toJstDay(t("2026-09-29T15:00:00Z"))).toBe("2026-09-30");
  });
});
