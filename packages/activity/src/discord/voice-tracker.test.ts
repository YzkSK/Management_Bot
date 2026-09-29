import { describe, expect, test } from "bun:test";
import type { HourlyDelta } from "../application/index.js";
import { VoiceTracker } from "./voice-tracker.js";

const t = (iso: string) => new Date(iso);
function setup() {
  const written: HourlyDelta[] = [];
  const tracker = new VoiceTracker(async (d) => {
    written.push(...d);
  });
  return { tracker, written };
}

describe("VoiceTracker", () => {
  test("計上開始→終了で区間を時間分割して書き込む", async () => {
    const { tracker, written } = setup();
    await tracker.update("g", "u", true, t("2026-09-29T10:50:00Z"));
    await tracker.update("g", "u", false, t("2026-09-29T11:10:00Z"));
    expect(written).toEqual([
      { guildId: "g", userId: "u", hour: t("2026-09-29T10:00:00Z"), messageCount: 0, voiceSeconds: 600 },
      { guildId: "g", userId: "u", hour: t("2026-09-29T11:00:00Z"), messageCount: 0, voiceSeconds: 600 },
    ]);
  });

  test("計上中に再度trueが来ても区間を二重に開始しない(移動・ミュート解除の重複通知)", async () => {
    const { tracker, written } = setup();
    await tracker.update("g", "u", true, t("2026-09-29T10:00:00Z"));
    await tracker.update("g", "u", true, t("2026-09-29T10:10:00Z"));
    await tracker.update("g", "u", false, t("2026-09-29T10:20:00Z"));
    expect(written.reduce((s, d) => s + d.voiceSeconds, 0)).toBe(1200);
  });

  test("非計上中のfalseは何も書かない", async () => {
    const { tracker, written } = setup();
    await tracker.update("g", "u", false, t("2026-09-29T10:00:00Z"));
    expect(written).toEqual([]);
  });

  test("closeAllで開いている区間をすべて確定する(停止時)", async () => {
    const { tracker, written } = setup();
    await tracker.update("g", "a", true, t("2026-09-29T10:00:00Z"));
    await tracker.update("g", "b", true, t("2026-09-29T10:30:00Z"));
    await tracker.closeAll(t("2026-09-29T10:40:00Z"));
    expect(written.map((d) => [d.userId, d.voiceSeconds])).toEqual([
      ["a", 2400],
      ["b", 600],
    ]);
  });
});
