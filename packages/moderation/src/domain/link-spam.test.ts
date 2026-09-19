import { describe, expect, test } from "bun:test";
import { hasLinkSpamHit, scoreLinkSpam } from "./link-spam.js";

function baseInput(overrides: Partial<Parameters<typeof scoreLinkSpam>[0]> = {}) {
  return { content: "hello", msSinceJoined: undefined, ...overrides };
}

describe("scoreLinkSpam", () => {
  test("何も該当しなければ0点", () => {
    expect(scoreLinkSpam(baseInput())).toBe(0);
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

  test("メンションとURL(プロトコルあり)の併用で20点", () => {
    expect(scoreLinkSpam(baseInput({ content: "<@123> https://example.com/join" }))).toBe(20);
  });

  test("メンションとURL(プロトコルなし)の併用でも20点(Codexレビュー指摘: discord.gg等の招待リンクも拾う)", () => {
    expect(scoreLinkSpam(baseInput({ content: "<@123> discord.gg/abc123" }))).toBe(20);
  });

  test("メンションのみ(URLなし)は加点されない", () => {
    expect(scoreLinkSpam(baseInput({ content: "<@123> hello" }))).toBe(0);
  });

  test("URLのみ(メンションなし)は加点されない", () => {
    expect(scoreLinkSpam(baseInput({ content: "https://example.com" }))).toBe(0);
  });

  test("短縮URLドメイン(プロトコル+パスあり)で10点", () => {
    expect(scoreLinkSpam(baseInput({ content: "check this out https://bit.ly/abc123" }))).toBe(10);
  });

  test("短縮URLドメイン(プロトコルなし)でも10点", () => {
    expect(scoreLinkSpam(baseInput({ content: "check this out bit.ly/abc123" }))).toBe(10);
  });

  test("短縮URLドメイン(パスなし)でも10点(Codexレビュー指摘)", () => {
    expect(scoreLinkSpam(baseInput({ content: "https://bit.ly" }))).toBe(10);
  });

  test("短縮URLでないドメインは加点されない", () => {
    expect(scoreLinkSpam(baseInput({ content: "https://example.com/bit.ly-lookalike" }))).toBe(0);
  });

  test("複数項目該当時は合算される", () => {
    const oneHourMs = 60 * 60 * 1000;
    const score = scoreLinkSpam({
      content: "<@123> サーバー宣伝 https://bit.ly/abc",
      msSinceJoined: oneHourMs,
    });
    // 参加24時間以内20 + 宣伝語句15 + メンション併用20 + 短縮URL10 = 65
    expect(score).toBe(65);
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
