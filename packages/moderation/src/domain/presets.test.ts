import { describe, expect, test } from "bun:test";
import {
  ESCALATION_STEPS,
  FLOOD_PRESETS,
  LINK_SPAM_PRESETS,
  MENTION_SPAM_PRESETS,
  MODERATION_PRESETS,
  RAID_PRESETS,
} from "./presets.js";

describe("moderation presets", () => {
  test("defines each supported severity", () => {
    expect(MODERATION_PRESETS).toEqual(["weak", "medium", "strong"]);
    expect(Object.keys(MENTION_SPAM_PRESETS).sort()).toEqual(["medium", "strong", "weak"]);
    expect(Object.keys(LINK_SPAM_PRESETS).sort()).toEqual(["medium", "strong", "weak"]);
    expect(Object.keys(RAID_PRESETS).sort()).toEqual(["medium", "strong", "weak"]);
    expect(Object.keys(ESCALATION_STEPS).sort()).toEqual(["medium", "strong", "weak"]);
  });

  test("flood presets only define detection conditions", () => {
    for (const preset of MODERATION_PRESETS) {
      expect(FLOOD_PRESETS[preset]).not.toHaveProperty("escalationSteps");
      expect(FLOOD_PRESETS[preset].frequency).toBeDefined();
      expect(FLOOD_PRESETS[preset].duplicateSimilarityThreshold).toBeDefined();
    }
  });

  test("stronger presets detect abuse with lower thresholds", () => {
    expect(MENTION_SPAM_PRESETS.strong.singleMessageThreshold).toBeLessThan(
      MENTION_SPAM_PRESETS.medium.singleMessageThreshold,
    );
    expect(MENTION_SPAM_PRESETS.medium.singleMessageThreshold).toBeLessThan(
      MENTION_SPAM_PRESETS.weak.singleMessageThreshold,
    );
    expect(LINK_SPAM_PRESETS.strong.deleteThreshold).toBeLessThan(LINK_SPAM_PRESETS.medium.deleteThreshold);
    expect(LINK_SPAM_PRESETS.medium.deleteThreshold).toBeLessThan(LINK_SPAM_PRESETS.weak.deleteThreshold);
    expect(RAID_PRESETS.strong.window.memberThreshold).toBeLessThan(RAID_PRESETS.medium.window.memberThreshold);
    expect(RAID_PRESETS.medium.window.memberThreshold).toBeLessThan(RAID_PRESETS.weak.window.memberThreshold);
  });

  test("raid presets retain their new-account ratio criteria", () => {
    expect(RAID_PRESETS.strong.newAccountRatioThreshold).toBeLessThan(RAID_PRESETS.medium.newAccountRatioThreshold);
    expect(RAID_PRESETS.medium.newAccountRatioThreshold).toBeLessThan(RAID_PRESETS.weak.newAccountRatioThreshold);
  });

  test("escalation retains warning and timeout steps", () => {
    expect(ESCALATION_STEPS.strong[1]).toEqual({ actionType: "warn" });
    expect(ESCALATION_STEPS.medium[3]).toEqual({ actionType: "timeout", timeoutMinutes: 5 });
    expect(ESCALATION_STEPS.weak[5]).toEqual({ actionType: "timeout", timeoutMinutes: 5 });
  });
});
