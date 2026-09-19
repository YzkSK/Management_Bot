import { describe, expect, test } from "bun:test";
import { hasLinkSpamHit, scoreLinkSpam } from "./link-spam.js";

function baseInput(overrides: Partial<Parameters<typeof scoreLinkSpam>[0]> = {}) {
  return { content: "hello", hasExternalInvite: false, msSinceJoined: undefined, ...overrides };
}

describe("scoreLinkSpam", () => {
  test("何も該当しなければ0点", () => {
    expect(scoreLinkSpam(baseInput())).toBe(0);
  });

  test("外部Discord招待で50点", () => {
    expect(scoreLinkSpam(baseInput({ hasExternalInvite: true }))).toBe(50);
  });

  test("参加24時間以内(ちょうど境界)で20点", () => {
    const oneDayMs = 24 * 60 * 60 * 1000;
    expect(scoreLinkSpam(baseInput({ msSinceJoined: oneDayMs }))).toBe(20);
  });

  test("参加24時間を1msでも超えると加点されない", () => {
    const overOneDayMs = 24 * 60 * 60 * 1000 + 1;
    expect(scoreLinkSpam(baseInput({ msSinceJoined: overOneDayMs }))).toBe(0);
  });

  test("msSinceJoinedが負(未来の参加日時等、通常起こらないケース)は加点しない", () => {
    expect(scoreLinkSpam(baseInput({ msSinceJoined: -1 }))).toBe(0);
  });

  test("宣伝語句を含むと15点", () => {
    expect(scoreLinkSpam(baseInput({ content: "サーバー宣伝させてください" }))).toBe(15);
  });

  test("メンションとURLの併用で20点", () => {
    expect(scoreLinkSpam(baseInput({ content: "<@123> https://example.com/join" }))).toBe(20);
  });

  test("メンションのみ(URLなし)は加点されない", () => {
    expect(scoreLinkSpam(baseInput({ content: "<@123> hello" }))).toBe(0);
  });

  test("URLのみ(メンションなし)は加点されない", () => {
    expect(scoreLinkSpam(baseInput({ content: "https://example.com" }))).toBe(0);
  });

  test("短縮URLドメインで10点", () => {
    expect(scoreLinkSpam(baseInput({ content: "check this out https://bit.ly/abc123" }))).toBe(10);
  });

  test("短縮URLでないドメインは加点されない", () => {
    expect(scoreLinkSpam(baseInput({ content: "https://example.com/bit.ly-lookalike" }))).toBe(0);
  });

  test("複数項目該当時は合算される", () => {
    const oneHourMs = 60 * 60 * 1000;
    const score = scoreLinkSpam({
      content: "<@123> サーバー宣伝 https://bit.ly/abc",
      hasExternalInvite: true,
      msSinceJoined: oneHourMs,
    });
    // 外部招待50 + 参加24時間以内20 + 宣伝語句15 + メンション併用20 + 短縮URL10 = 115
    expect(score).toBe(115);
  });
});

describe("hasLinkSpamHit", () => {
  test("スコアが閾値未満はfalse", () => {
    expect(hasLinkSpamHit(49, 50)).toBe(false);
  });

  test("スコアがちょうど閾値ならtrue(境界値)", () => {
    expect(hasLinkSpamHit(50, 50)).toBe(true);
  });
});
