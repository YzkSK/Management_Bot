import { describe, expect, test } from "bun:test";
import {
  formatScheduleInput,
  formatScheduledAt,
  parseScheduleInput,
  resolveScheduledAt,
  validateScheduledAt,
} from "./schedule-time.js";

/** 2026-10-05 12:00:30 JST(= 03:00:30 UTC)。 */
const NOW = new Date("2026-10-05T03:00:30.000Z");

function ok(input: string, now: Date = NOW): string {
  const result = parseScheduleInput(input, now);
  if (!result.ok) throw new Error(`expected ok: ${input} -> ${result.error}`);
  return result.date.toISOString();
}

describe("parseScheduleInput", () => {
  test("絶対指定はJSTとして解釈する", () => {
    expect(ok("2026/10/10 20:00")).toBe("2026-10-10T11:00:00.000Z");
  });

  test("年省略はJSTの今年として解釈する", () => {
    expect(ok("10/10 20:00")).toBe("2026-10-10T11:00:00.000Z");
    expect(ok("1/2 3:04")).toBe("2026-01-01T18:04:00.000Z");
  });

  test("年省略で今年中に過ぎた日付でも解釈自体は成功し、検証で弾く", () => {
    const parsed = parseScheduleInput("1/1 00:00", NOW);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && validateScheduledAt(parsed.date, NOW)).toMatchObject({ ok: false, error: "past" });
  });

  test("全角数字・全角記号も受け付ける", () => {
    expect(ok("２０２６／１０／１０ ２０：００")).toBe("2026-10-10T11:00:00.000Z");
  });

  test("相対指定は分・時間・日後で、分単位に切り捨てる", () => {
    expect(ok("30分後")).toBe("2026-10-05T03:30:00.000Z");
    expect(ok("2時間後")).toBe("2026-10-05T05:00:00.000Z");
    expect(ok("3日後")).toBe("2026-10-08T03:00:00.000Z");
    expect(ok("1 時間後")).toBe("2026-10-05T04:00:00.000Z");
  });

  test("存在しない日時はinvalid_date", () => {
    for (const input of ["2026/02/30 10:00", "2026/13/01 10:00", "2026/10/10 24:00", "2026/10/10 10:60"]) {
      expect(parseScheduleInput(input, NOW)).toMatchObject({ ok: false, error: "invalid_date" });
    }
  });

  test("対応しない書式・0以下の相対指定はinvalid_format", () => {
    for (const input of ["", "明日", "10/10", "0分後", "30秒後", "1週間後", "2026/10/10 20:00:00", "30分前"]) {
      expect(parseScheduleInput(input, NOW)).toMatchObject({ ok: false, error: "invalid_format" });
    }
  });
});

describe("validateScheduledAt", () => {
  const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

  test("過去・1分以内・半年超はエラー、1分超〜半年以内は許可", () => {
    expect(validateScheduledAt(at(-1), NOW)).toMatchObject({ error: "past" });
    expect(validateScheduledAt(at(0), NOW)).toMatchObject({ error: "past" });
    expect(validateScheduledAt(at(60_000), NOW)).toMatchObject({ error: "too_soon" });
    expect(validateScheduledAt(at(60_001), NOW).ok).toBe(true);
    expect(validateScheduledAt(at(183 * 86_400_000), NOW).ok).toBe(true);
    expect(validateScheduledAt(at(183 * 86_400_000 + 1), NOW)).toMatchObject({ error: "too_far" });
  });

  test("resolveScheduledAtは構文エラーも検証エラーもメッセージ付きで返す", () => {
    expect(resolveScheduledAt("あした", NOW)).toMatchObject({ ok: false, error: "invalid_format" });
    expect(resolveScheduledAt("1分後", NOW)).toMatchObject({ ok: false, error: "too_soon" });
    expect(resolveScheduledAt("400日後", NOW)).toMatchObject({ ok: false, error: "too_far" });
    expect(resolveScheduledAt("2時間後", NOW).ok).toBe(true);
  });
});

describe("formatScheduledAt / formatScheduleInput", () => {
  test("日時と残り時間を表示する", () => {
    const at = new Date("2026-10-10T11:00:00.000Z");
    expect(formatScheduledAt(at, new Date("2026-10-10T08:00:00.000Z"))).toBe("10月10日 20:00(あと3時間)");
    expect(formatScheduledAt(at, new Date("2026-10-10T10:30:00.000Z"))).toBe("10月10日 20:00(あと30分)");
    expect(formatScheduledAt(at, new Date("2026-10-05T11:00:00.000Z"))).toBe("10月10日 20:00(あと5日)");
    expect(formatScheduledAt(at, new Date("2026-10-10T11:00:00.000Z"))).toBe("10月10日 20:00(まもなく)");
  });

  test("今年以外は年を付ける", () => {
    expect(formatScheduledAt(new Date("2027-01-05T11:00:00.000Z"), NOW)).toBe("2027年1月5日 20:00(あと92日)");
  });

  test("モーダル初期値はパース可能な形式", () => {
    const at = new Date("2026-10-10T11:00:00.000Z");
    expect(formatScheduleInput(at)).toBe("2026/10/10 20:00");
    expect(ok(formatScheduleInput(at))).toBe(at.toISOString());
  });
});
