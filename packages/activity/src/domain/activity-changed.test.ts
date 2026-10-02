import { describe, expect, test } from "bun:test";
import { activityChangedChannel, parseActivityChanged } from "./activity-changed.js";

describe("parseActivityChanged", () => {
  test("チャンネル名からguildId、payloadからkindを取り出す", () => {
    expect(parseActivityChanged(activityChangedChannel("123"), JSON.stringify({ kind: "stats" }))).toEqual({
      guildId: "123",
      kind: "stats",
    });
  });

  test("不正なJSON・kind・チャンネル名は無視する", () => {
    expect(parseActivityChanged(activityChangedChannel("1"), "{")).toBeUndefined();
    expect(parseActivityChanged(activityChangedChannel("1"), JSON.stringify({ kind: "x" }))).toBeUndefined();
    expect(parseActivityChanged("other:1", JSON.stringify({ kind: "voice" }))).toBeUndefined();
    expect(parseActivityChanged("activity:changed:", JSON.stringify({ kind: "voice" }))).toBeUndefined();
  });
});
