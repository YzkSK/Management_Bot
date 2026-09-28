import { describe, expect, test } from "bun:test";
import { decideEscalationAction, mostSevere } from "./escalation.js";

describe("decideEscalationAction", () => {
  const steps = { 1: "warn", 3: "kick", 5: "timeout" };

  test("最小キー未満のstrikeCountはnull", () => {
    expect(decideEscalationAction(0, steps)).toBeNull();
  });

  test("キーちょうどのstrikeCountはそのアクション(境界値)", () => {
    expect(decideEscalationAction(1, steps)).toBe("warn");
    expect(decideEscalationAction(3, steps)).toBe("kick");
    expect(decideEscalationAction(5, steps)).toBe("timeout");
  });

  test("キー間のstrikeCountは直前のステップを維持する", () => {
    expect(decideEscalationAction(2, steps)).toBe("warn");
    expect(decideEscalationAction(4, steps)).toBe("kick");
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

describe("mostSevere", () => {
  test("actionTypeが最も重いものを返す", () => {
    const outcomes = [
      { caseId: "a", actionType: "warn" as const },
      { caseId: "b", actionType: "kick" as const },
      { caseId: "c", actionType: "timeout" as const },
    ];
    expect(mostSevere(outcomes).caseId).toBe("b");
  });

  test("同じ重さの場合は先に出てきたものを返す", () => {
    const outcomes = [
      { caseId: "a", actionType: "timeout" as const },
      { caseId: "b", actionType: "timeout" as const },
    ];
    expect(mostSevere(outcomes).caseId).toBe("a");
  });
});
