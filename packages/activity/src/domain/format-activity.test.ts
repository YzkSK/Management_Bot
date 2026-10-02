import { describe, expect, test } from "bun:test";
import { buildActivityMeReply, formatDuration } from "./format-activity.js";

describe("formatDuration", () => {
  test("時間と分で表す", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(59)).toBe("0m");
    expect(formatDuration(20 * 60)).toBe("20m");
    expect(formatDuration(14 * 3600 + 20 * 60 + 30)).toBe("14h 20m");
    expect(formatDuration(3600)).toBe("1h 0m");
  });
});

describe("buildActivityMeReply", () => {
  test("合計・順位・日別を含む", () => {
    const text = buildActivityMeReply(
      {
        totals: { messageCount: 312, voiceSeconds: 14 * 3600 + 20 * 60 },
        rank: { messages: 1, voice: null },
        daily: [
          { bucket: "2026-09-23", messageCount: 40, voiceSeconds: 7800 },
          { bucket: "2026-09-24", messageCount: 0, voiceSeconds: 60 },
        ],
      },
      7,
    );
    expect(text).toEqual({
      title: "直近7日のアクティビティ",
      summary: "**発言数**: 312 / **VC時間**: 14h 20m\n**サーバー内順位**: 発言 1位 / VC -",
      daily: "09/23 発言 40 / VC 2h 10m\n09/24 発言 0 / VC 1m",
    });
  });

  test("活動が無ければその旨を返す", () => {
    const text = buildActivityMeReply(
      { totals: { messageCount: 0, voiceSeconds: 0 }, rank: { messages: null, voice: null }, daily: [] },
      30,
    );
    expect(text).toEqual({ title: "直近30日のアクティビティ", summary: "直近30日のアクティビティはありません。", daily: null });
  });
});
