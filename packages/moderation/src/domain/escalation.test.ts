import { describe, expect, test } from "bun:test";
import { decideEscalationAction } from "./escalation.js";

describe("decideEscalationAction", () => {
  const steps = { 1: "warn", 3: "messageDelete", 5: "timeout" } as const;

  test("最小キー未満のstrikeCountはnull", () => {
    expect(decideEscalationAction(0, steps)).toBeNull();
  });

  test("キーちょうどのstrikeCountはそのアクション(境界値)", () => {
    expect(decideEscalationAction(1, steps)).toBe("warn");
    expect(decideEscalationAction(3, steps)).toBe("messageDelete");
    expect(decideEscalationAction(5, steps)).toBe("timeout");
  });

  test("キー間のstrikeCountは直前のステップを維持する", () => {
    expect(decideEscalationAction(2, steps)).toBe("warn");
    expect(decideEscalationAction(4, steps)).toBe("messageDelete");
  });

  test("最大キーを超えるstrikeCountは最大キーのアクションを維持する", () => {
    expect(decideEscalationAction(100, steps)).toBe("timeout");
  });

  test("escalationStepsが空ならnull", () => {
    expect(decideEscalationAction(10, {})).toBeNull();
  });

  test("strikeCountが負数・非整数はRangeError", () => {
    expect(() => decideEscalationAction(-1, steps)).toThrow(RangeError);
    expect(() => decideEscalationAction(1.5, steps)).toThrow(RangeError);
  });
});
