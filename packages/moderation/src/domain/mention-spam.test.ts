import { describe, expect, test } from "bun:test";
import { countMentions, hasCumulativeMentionSpam, hasSingleMessageMentionSpam } from "./mention-spam.js";

describe("countMentions", () => {
  test("user/roleメンションを数える", () => {
    expect(countMentions("hi <@123> and <@!456> and <@&789>")).toBe(3);
  });

  test("メンションがなければ0", () => {
    expect(countMentions("no mentions here")).toBe(0);
  });
});

describe("hasSingleMessageMentionSpam", () => {
  test("閾値未満はfalse", () => {
    expect(hasSingleMessageMentionSpam(4, 5)).toBe(false);
  });

  test("ちょうど閾値はtrue(境界値)", () => {
    expect(hasSingleMessageMentionSpam(5, 5)).toBe(true);
  });

  test("thresholdが1未満はRangeError", () => {
    expect(() => hasSingleMessageMentionSpam(1, 0)).toThrow(RangeError);
  });
});

describe("hasCumulativeMentionSpam", () => {
  test("合計が閾値未満はfalse", () => {
    expect(hasCumulativeMentionSpam([1, 2], 5)).toBe(false);
  });

  test("合計がちょうど閾値ならtrue(境界値)", () => {
    expect(hasCumulativeMentionSpam([2, 3], 5)).toBe(true);
  });

  test("thresholdが1未満はRangeError", () => {
    expect(() => hasCumulativeMentionSpam([1], 0)).toThrow(RangeError);
  });
});
