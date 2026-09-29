import { describe, expect, test } from "bun:test";
import { addToBucket, currentBucket, currentJstHour, liveVoiceSeconds, parseActivityNotification, sumLive } from "./activity-live.js";

const clock = new Date("2026-09-29T12:00:30.000Z");

describe("liveVoiceSeconds", () => {
  test("集計中のメンバーだけ (現在 − countingSince) 秒を返す", () => {
    const live = liveVoiceSeconds(
      [
        {
          members: [
            { userId: "u1", countingSince: "2026-09-29T12:00:00.000Z" },
            { userId: "u2", countingSince: null },
            // 時計のずれで未来になっても負にしない
            { userId: "u3", countingSince: "2026-09-29T12:01:00.000Z" },
          ],
        },
      ],
      clock,
    );
    expect(live.get("u1")).toBe(30);
    expect(live.has("u2")).toBe(false);
    expect(live.get("u3")).toBe(0);
    expect(sumLive(live)).toBe(30);
  });
});

describe("addToBucket / currentBucket", () => {
  const make = (bucket: string) => ({ bucket, messageCount: 0, voiceSeconds: 0 });

  test("該当bucketに加算し、無ければ作る", () => {
    expect(addToBucket([make("a")], "a", 5, make)[0]?.voiceSeconds).toBe(5);
    expect(addToBucket([], "b", 5, make)).toEqual([{ bucket: "b", messageCount: 0, voiceSeconds: 5 }]);
    expect(addToBucket([make("a")], "a", 0, make)[0]?.voiceSeconds).toBe(0);
  });

  test("時間別はUTC時間先頭、日別はJST日付、時はJST", () => {
    expect(currentBucket(clock, "hour")).toBe("2026-09-29T12:00:00.000Z");
    expect(currentBucket(new Date("2026-09-29T15:30:00Z"), "day")).toBe("2026-09-30");
    expect(currentJstHour(clock)).toBe(21);
  });
});

describe("parseActivityNotification", () => {
  test("kindを取り出し、不正はnull", () => {
    expect(parseActivityNotification(JSON.stringify({ type: "activityChanged", kind: "voice" }))).toBe("voice");
    expect(parseActivityNotification(JSON.stringify({ type: "newLogEntry", category: "x" }))).toBeNull();
    expect(parseActivityNotification("{")).toBeNull();
  });
});
