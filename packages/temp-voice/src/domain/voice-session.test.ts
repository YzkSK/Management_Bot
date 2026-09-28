import { describe, expect, test } from "bun:test";
import { buildVoiceSessionEndedEvent } from "./voice-session.js";

describe("buildVoiceSessionEndedEvent", () => {
  test("開始・終了時刻からdurationSecondsを算出する", () => {
    const startedAt = new Date("2026-09-24T00:00:00.000Z");
    const endedAt = new Date("2026-09-24T00:10:00.000Z");

    const event = buildVoiceSessionEndedEvent({ guildId: "g1", userId: "u1", channelId: "c1", startedAt, endedAt });

    expect(event).toEqual({
      type: "voice.session.ended",
      guildId: "g1",
      userId: "u1",
      channelId: "c1",
      startedAt: "2026-09-24T00:00:00.000Z",
      endedAt: "2026-09-24T00:10:00.000Z",
      durationSeconds: 600,
    });
  });

  test("端数のミリ秒は四捨五入する", () => {
    const startedAt = new Date("2026-09-24T00:00:00.000Z");
    const endedAt = new Date("2026-09-24T00:00:00.600Z");

    const event = buildVoiceSessionEndedEvent({ guildId: "g1", userId: "u1", channelId: "c1", startedAt, endedAt });

    expect(event.durationSeconds).toBe(1);
  });

  test("endedAtがstartedAtより前(時刻巻き戻り等)でもendedAt=startedAtに補正しdurationSeconds=0にする", () => {
    const startedAt = new Date("2026-09-24T00:10:00.000Z");
    const endedAt = new Date("2026-09-24T00:00:00.000Z");

    const event = buildVoiceSessionEndedEvent({ guildId: "g1", userId: "u1", channelId: "c1", startedAt, endedAt });

    expect(event.durationSeconds).toBe(0);
    expect(event.endedAt).toBe(event.startedAt);
  });
});
