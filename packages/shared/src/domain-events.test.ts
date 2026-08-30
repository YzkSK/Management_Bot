import { describe, expect, test } from "bun:test";
import { voiceSessionEndedSchema } from "./domain-events.ts";

describe("voiceSessionEndedSchema", () => {
  test("正しいpayloadをparseできる", () => {
    const result = voiceSessionEndedSchema.parse({
      type: "voice.session.ended",
      guildId: "1",
      userId: "2",
      channelId: "3",
      startedAt: "2026-08-29T00:00:00.000Z",
      endedAt: "2026-08-29T00:10:00.000Z",
      durationSeconds: 600,
    });
    expect(result.durationSeconds).toBe(600);
  });

  test("負のdurationSecondsは拒否する", () => {
    expect(() =>
      voiceSessionEndedSchema.parse({
        type: "voice.session.ended",
        guildId: "1",
        userId: "2",
        channelId: "3",
        startedAt: "2026-08-29T00:00:00.000Z",
        endedAt: "2026-08-29T00:10:00.000Z",
        durationSeconds: -1,
      }),
    ).toThrow();
  });

  test("endedAtがstartedAtより前の場合は拒否する", () => {
    expect(() =>
      voiceSessionEndedSchema.parse({
        type: "voice.session.ended",
        guildId: "1",
        userId: "2",
        channelId: "3",
        startedAt: "2026-08-29T00:10:00.000Z",
        endedAt: "2026-08-29T00:00:00.000Z",
        durationSeconds: 0,
      }),
    ).toThrow();
  });
});
