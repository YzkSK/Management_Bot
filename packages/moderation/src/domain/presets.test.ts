import { describe, expect, test } from "bun:test";
import { ESCALATION_STEPS, FLOOD_PRESETS, MENTION_SPAM_PRESETS, MODERATION_PRESETS } from "./presets.js";

describe("FLOOD_PRESETS", () => {
  test("escalationStepsフィールドを持たない(検知条件のみ)", () => {
    for (const preset of MODERATION_PRESETS) {
      expect(FLOOD_PRESETS[preset]).not.toHaveProperty("escalationSteps");
      expect(FLOOD_PRESETS[preset].frequency).toBeDefined();
      expect(FLOOD_PRESETS[preset].duplicateSimilarityThreshold).toBeDefined();
    }
  });
});

describe("MENTION_SPAM_PRESETS", () => {
  test("weak/medium/strongの3プリセットを持ち、strongほど閾値が厳しい", () => {
    expect(Object.keys(MENTION_SPAM_PRESETS).sort()).toEqual(["medium", "strong", "weak"]);
    expect(MENTION_SPAM_PRESETS.strong.singleMessageThreshold).toBeLessThan(
      MENTION_SPAM_PRESETS.medium.singleMessageThreshold,
    );
    expect(MENTION_SPAM_PRESETS.medium.singleMessageThreshold).toBeLessThan(
      MENTION_SPAM_PRESETS.weak.singleMessageThreshold,
    );
  });
});

describe("ESCALATION_STEPS", () => {
  test("weak/medium/strongの3プリセットを持つ", () => {
    expect(Object.keys(ESCALATION_STEPS).sort()).toEqual(["medium", "strong", "weak"]);
  });

  test("strongはstrikeCount=1でwarnになる(削除は付随処理として実行される)", () => {
    expect(ESCALATION_STEPS.strong[1]).toEqual({ actionType: "warn" });
  });

  test("mediumはstrikeCount=1でwarn、3〜5でtimeoutが5→10→30分と多段階化する", () => {
    expect(ESCALATION_STEPS.medium[1]).toEqual({ actionType: "warn" });
    expect(ESCALATION_STEPS.medium[3]).toEqual({ actionType: "timeout", timeoutMinutes: 5 });
    expect(ESCALATION_STEPS.medium[4]).toEqual({ actionType: "timeout", timeoutMinutes: 10 });
    expect(ESCALATION_STEPS.medium[5]).toEqual({ actionType: "timeout", timeoutMinutes: 30 });
  });

  test("weakはstrikeCount=1でwarn、5〜7でtimeoutが5→10→30分と多段階化する", () => {
    expect(ESCALATION_STEPS.weak[1]).toEqual({ actionType: "warn" });
    expect(ESCALATION_STEPS.weak[5]).toEqual({ actionType: "timeout", timeoutMinutes: 5 });
    expect(ESCALATION_STEPS.weak[6]).toEqual({ actionType: "timeout", timeoutMinutes: 10 });
    expect(ESCALATION_STEPS.weak[7]).toEqual({ actionType: "timeout", timeoutMinutes: 30 });
  });
});
