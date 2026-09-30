import { describe, expect, test } from "bun:test";
import { VOICE_OCCUPIED_USER_ID, type HourlyDelta } from "../application/index.js";
import { VoiceTracker } from "./voice-tracker.js";

const t = (iso: string) => new Date(iso);
/** writtenはメンバーごとの行、occupiedはサーバー単位の「誰かがVCにいた時間」の行。 */
function setup() {
  const written: HourlyDelta[] = [];
  const occupied: HourlyDelta[] = [];
  const tracker = new VoiceTracker(async (deltas) => {
    for (const d of deltas) (d.userId === VOICE_OCCUPIED_USER_ID ? occupied : written).push(d);
  });
  return { tracker, written, occupied };
}
const seconds = (deltas: HourlyDelta[]) => deltas.reduce((sum, d) => sum + d.voiceSeconds, 0);

describe("VoiceTracker", () => {
  test("計上開始→終了で区間を時間分割して書き込む", async () => {
    const { tracker, written } = setup();
    await tracker.update("g", "u", true, t("2026-09-29T10:50:00Z"));
    await tracker.update("g", "u", false, t("2026-09-29T11:10:00Z"));
    expect(written).toEqual([
      { guildId: "g", userId: "u", hour: t("2026-09-29T10:00:00Z"), messageCount: 0, voiceSeconds: 600 },
      { guildId: "g", userId: "u", hour: t("2026-09-29T11:00:00Z"), messageCount: 0, voiceSeconds: 600, lastVoiceAt: t("2026-09-29T11:10:00Z") },
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

  test("checkpointは開いている区間をその時点まで書き込み、計上を続ける(在室が長い場合も途中経過を反映する)", async () => {
    const { tracker, written } = setup();
    await tracker.update("g", "u", true, t("2026-09-29T10:00:00Z"));
    await tracker.checkpoint(t("2026-09-29T10:10:00Z"));
    await tracker.update("g", "u", false, t("2026-09-29T10:15:00Z"));
    expect(written.map((d) => d.voiceSeconds)).toEqual([600, 300]);
  });
});

describe("VoiceTracker: サーバー単位の在室時間(issue #508)", () => {
  test("重なって在室した時間は1回だけ数え、全員が抜けたら閉じる", async () => {
    const { tracker, written, occupied } = setup();
    await tracker.update("g", "a", true, t("2026-09-29T10:00:00Z"));
    await tracker.update("g", "b", true, t("2026-09-29T10:10:00Z"));
    await tracker.update("g", "a", false, t("2026-09-29T10:20:00Z"));
    expect(occupied).toEqual([]);
    await tracker.update("g", "b", false, t("2026-09-29T10:30:00Z"));
    expect(seconds(written)).toBe(2400);
    expect(seconds(occupied)).toBe(1800);
  });

  test("サーバーごとに別々に数え、同じ人の重複通知で人数を増やさない", async () => {
    const { tracker, occupied } = setup();
    await tracker.update("g1", "a", true, t("2026-09-29T10:00:00Z"));
    await tracker.update("g1", "a", true, t("2026-09-29T10:05:00Z"));
    await tracker.update("g2", "b", true, t("2026-09-29T10:00:00Z"));
    await tracker.update("g1", "a", false, t("2026-09-29T10:10:00Z"));
    expect(occupied.map((d) => [d.guildId, d.voiceSeconds])).toEqual([["g1", 600]]);
  });

  test("checkpointとcloseAllでも在室区間を書き込む", async () => {
    const { tracker, occupied } = setup();
    await tracker.update("g", "a", true, t("2026-09-29T10:00:00Z"));
    await tracker.update("g", "b", true, t("2026-09-29T10:00:00Z"));
    await tracker.checkpoint(t("2026-09-29T10:10:00Z"));
    await tracker.closeAll(t("2026-09-29T10:15:00Z"));
    expect(occupied.map((d) => d.voiceSeconds)).toEqual([600, 300]);
  });
});

describe("VoiceTracker.countingSince", () => {
  test("開いている区間の開始時刻を返し、checkpointで前進し、閉じたら消える", async () => {
    const tracker = new VoiceTracker(async () => undefined);
    const t0 = new Date("2026-09-29T10:00:00Z");
    const t1 = new Date("2026-09-29T10:01:00Z");
    await tracker.update("g", "u", true, t0);
    expect(tracker.countingSince("g", "u")).toEqual(t0);
    expect(await tracker.checkpoint(t1)).toEqual([{ guildId: "g", userId: "u" }]);
    expect(tracker.countingSince("g", "u")).toEqual(t1);
    await tracker.update("g", "u", false, t1);
    expect(tracker.countingSince("g", "u")).toBeUndefined();
  });
});

