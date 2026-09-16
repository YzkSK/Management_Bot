import { describe, expect, test } from "bun:test";
import { ESCALATION_STEPS, FLOOD_PRESETS, MODERATION_PRESETS } from "./presets.js";

describe("FLOOD_PRESETS", () => {
  test("escalationStepsフィールドを持たない(検知条件のみ)", () => {
    for (const preset of MODERATION_PRESETS) {
      expect(FLOOD_PRESETS[preset]).not.toHaveProperty("escalationSteps");
      expect(FLOOD_PRESETS[preset].frequency).toBeDefined();
      expect(FLOOD_PRESETS[preset].duplicateSimilarityThreshold).toBeDefined();
    }
  });
});

describe("ESCALATION_STEPS", () => {
  test("weak/medium/strongの3プリセットを持つ", () => {
    expect(Object.keys(ESCALATION_STEPS).sort()).toEqual(["medium", "strong", "weak"]);
  });

  test("strongはstrikeCount=1でwarnになる(削除は付随処理として実行される)", () => {
    expect(ESCALATION_STEPS.strong[1]).toBe("warn");
  });

  test("mediumはstrikeCount=1でwarn、3でtimeoutになる", () => {
    expect(ESCALATION_STEPS.medium[1]).toBe("warn");
    expect(ESCALATION_STEPS.medium[3]).toBe("timeout");
  });

  test("weakはstrikeCount=1でwarn、5でtimeoutになる", () => {
    expect(ESCALATION_STEPS.weak[1]).toBe("warn");
    expect(ESCALATION_STEPS.weak[5]).toBe("timeout");
  });
});
