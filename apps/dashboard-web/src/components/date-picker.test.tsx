import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DatePicker, formatDateDisplay, formatDateString, parseDateString } from "./date-picker.js";

describe("parseDateString / formatDateString", () => {
  test("YYYY-MM-DDをローカル日付のDateにする(UTC解釈で前日にならない)", () => {
    const date = parseDateString("2026-01-01");
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(0);
    expect(date?.getDate()).toBe(1);
    expect(date?.getHours()).toBe(0);
  });

  test("日の境界(0:00と23:59:59)でもローカル日付のままYYYY-MM-DDに戻る", () => {
    expect(formatDateString(new Date(2026, 0, 1, 0, 0, 0))).toBe("2026-01-01");
    expect(formatDateString(new Date(2026, 11, 31, 23, 59, 59))).toBe("2026-12-31");
  });

  test("往復しても同じ値になり、月・日はゼロ埋めされる", () => {
    for (const value of ["2026-03-05", "2024-02-29", "1999-12-31"]) {
      const date = parseDateString(value);
      expect(date && formatDateString(date)).toBe(value);
    }
  });

  test("空文字・形式不正・存在しない日付はundefined", () => {
    for (const value of ["", "2026/01/01", "2026-1-1", "2026-02-31", "2025-02-29", "2026-13-01", "abc"]) {
      expect(parseDateString(value)).toBeUndefined();
    }
  });
});

describe("formatDateDisplay", () => {
  test("YYYY/MM/DD形式で表示し、未選択・不正値は表示なし", () => {
    expect(formatDateDisplay("2026-03-05")).toBe("2026/03/05");
    expect(formatDateDisplay("")).toBeUndefined();
    expect(formatDateDisplay("2026-02-31")).toBeUndefined();
  });
});

describe("DatePicker", () => {
  test("未選択ならplaceholderを表示し、aria-labelをトリガーに付ける", () => {
    const html = renderToStaticMarkup(<DatePicker aria-label="開始日" value="" onChange={() => {}} />);
    expect(html).toContain("日付を選択");
    expect(html).toContain('aria-label="開始日"');
  });

  test("選択済みならYYYY/MM/DDを表示し、placeholderは出さない", () => {
    const html = renderToStaticMarkup(<DatePicker aria-label="終了日" value="2026-03-05" onChange={() => {}} />);
    expect(html).toContain("2026/03/05");
    expect(html).not.toContain("日付を選択");
  });
});
