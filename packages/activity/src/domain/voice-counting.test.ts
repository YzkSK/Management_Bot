import { describe, expect, test } from "bun:test";
import { isCounting, type VoiceStateSnapshot } from "./voice-counting.js";

const base: VoiceStateSnapshot = { channelId: "vc", selfMute: false, selfDeaf: false, serverMute: false, serverDeaf: false };

describe("isCounting", () => {
  test("在室・非ミュートなら計上", () => expect(isCounting(base, "afk")).toBe(true));
  test("未在室は計上しない", () => expect(isCounting({ ...base, channelId: null }, "afk")).toBe(false));
  test("AFKチャンネルは計上しない", () => expect(isCounting({ ...base, channelId: "afk" }, "afk")).toBe(false));
  test("AFK未設定ギルドでも在室なら計上", () => expect(isCounting(base, null)).toBe(true));
  for (const key of ["selfMute", "selfDeaf", "serverMute", "serverDeaf"] as const) {
    test(`${key}中は計上しない`, () => expect(isCounting({ ...base, [key]: true }, "afk")).toBe(false));
  }
});
