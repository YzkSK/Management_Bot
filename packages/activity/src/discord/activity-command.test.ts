import { describe, expect, mock, test } from "bun:test";
import type { MemberDetail } from "../application/index.js";
import { ACTIVITY_COMMAND, buildActivityMeResponse, parsePeriodDays } from "./activity-command.js";

const detail: MemberDetail = {
  totals: { messageCount: 5, voiceSeconds: 600 },
  rank: { messages: 1, voice: 1 },
  byHourOfDay: { messageCount: [], voiceSeconds: [] },
  daily: [{ bucket: "2026-09-29", messageCount: 5, voiceSeconds: 600 }],
  lastMessageAt: null,
  lastVoiceAt: null,
};

describe("parsePeriodDays", () => {
  test("7/30以外や未指定は7日", () => {
    expect(parsePeriodDays("30")).toBe(30);
    expect(parsePeriodDays("7")).toBe(7);
    expect(parsePeriodDays(null)).toBe(7);
    expect(parsePeriodDays("365")).toBe(7);
  });
});

describe("buildActivityMeResponse", () => {
  test("本人のguild/userと直近N日の範囲で集計し、返信本文を作る", async () => {
    const getDetail = mock(async () => detail);
    const now = new Date("2026-09-29T12:00:00Z");
    const text = await buildActivityMeResponse({ guildId: "g", userId: "u", periodDays: 7, now }, getDetail);
    expect(getDetail).toHaveBeenCalledWith({
      guildId: "g",
      userId: "u",
      from: new Date("2026-09-22T12:00:00Z"),
      to: now,
    });
    expect(text).toContain("発言数: 5 / VC時間: 10m");
  });
});

describe("ACTIVITY_COMMAND", () => {
  test("activity me サブコマンドとperiodの選択肢を持つ", () => {
    expect(ACTIVITY_COMMAND.name).toBe("activity");
    expect(JSON.stringify(ACTIVITY_COMMAND)).toContain('"name":"me"');
  });
});
