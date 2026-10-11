import { describe, expect, test } from "bun:test";
import { auditFeatureLabel, auditOutcomeLabel, dateInputToIso } from "./audit-log-labels.js";

describe("audit-log-labels", () => {
  test("既知のキーは日本語、未知のキーはそのまま返す", () => {
    expect(auditFeatureLabel("tempVoice")).toBe("一時VC");
    expect(auditFeatureLabel("custom")).toBe("custom");
    expect(auditOutcomeLabel("denied")).toBe("権限不足");
    expect(auditOutcomeLabel("pending")).toBe("結果不明");
  });

  test("dateInputToIsoは終了日を翌日0時(排他的上限)にする。不正値はundefined", () => {
    const from = dateInputToIso("2026-10-10", false);
    const to = dateInputToIso("2026-10-10", true);
    expect(new Date(to ?? "").getTime() - new Date(from ?? "").getTime()).toBeGreaterThanOrEqual(23 * 3600_000);
    expect(dateInputToIso("", false)).toBeUndefined();
    expect(dateInputToIso("bad", true)).toBeUndefined();
  });
});
