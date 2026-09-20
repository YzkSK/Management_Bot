import { describe, expect, test } from "bun:test";
import { MODERATION_ESCALATION_VIOLATION_TYPES, MODERATION_VIOLATION_TYPES } from "./moderation-violation-type.js";

describe("moderation violation types", () => {
  test("new_account_guard はモデレーション設定種別に含めない", () => {
    expect(MODERATION_VIOLATION_TYPES).not.toContain("new_account_guard");
    expect(MODERATION_ESCALATION_VIOLATION_TYPES).not.toContain("new_account_guard");
  });
});
