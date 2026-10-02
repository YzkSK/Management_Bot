import { describe, expect, test } from "bun:test";
import { type ActiveVoiceEntry, activeVoiceKey, groupActiveVoice, nextJoinedAt, parseActiveVoiceEntry } from "./active-voice.js";

function entry(overrides: Partial<ActiveVoiceEntry> = {}): ActiveVoiceEntry {
  return {
    channelId: "c1",
    channelName: "雑談VC",
    afk: false,
    name: "Alice",
    avatarUrl: null,
    joinedAt: "2026-09-29T10:00:00.000Z",
    selfMute: false,
    selfDeaf: false,
    serverMute: false,
    serverDeaf: false,
    streaming: false,
    video: false,
    countingSince: null,
    ...overrides,
  };
}

describe("activeVoiceKey", () => {
  test("ギルド単位のキー", () => {
    expect(activeVoiceKey("g1")).toBe("activity:voice:g1");
  });
});

describe("nextJoinedAt", () => {
  const now = new Date("2026-09-29T12:00:00.000Z");
  test("同じチャンネルなら以前の入室時刻を保つ(ミュート切替で継続時間をリセットしない)", () => {
    expect(nextJoinedAt(entry(), "c1", now)).toBe("2026-09-29T10:00:00.000Z");
  });
  test("移動・新規入室なら現在時刻", () => {
    expect(nextJoinedAt(entry(), "c2", now)).toBe(now.toISOString());
    expect(nextJoinedAt(undefined, "c1", now)).toBe(now.toISOString());
  });
});

describe("parseActiveVoiceEntry", () => {
  test("正しいJSON文字列を受け付ける", () => {
    expect(parseActiveVoiceEntry(JSON.stringify(entry()))).toEqual(entry());
  });
  test("壊れたJSON・スキーマ外はundefined", () => {
    expect(parseActiveVoiceEntry("{broken")).toBeUndefined();
    expect(parseActiveVoiceEntry(JSON.stringify({ channelId: 1 }))).toBeUndefined();
    expect(parseActiveVoiceEntry(null)).toBeUndefined();
  });
});

describe("groupActiveVoice", () => {
  test("チャンネル別に集約し、人数の多い順・入室順に並べ、継続時間の起点は最初の入室", () => {
    const hash = {
      u1: JSON.stringify(entry({ name: "A", joinedAt: "2026-09-29T11:00:00.000Z" })),
      u2: JSON.stringify(entry({ name: "B", joinedAt: "2026-09-29T09:00:00.000Z", selfMute: true })),
      u3: JSON.stringify(entry({ channelId: "c2", channelName: "ゲームVC", name: "C" })),
      broken: "{",
    };
    const channels = groupActiveVoice(hash);
    expect(channels.map((c) => c.channelId)).toEqual(["c1", "c2"]);
    expect(channels[0]?.startedAt).toBe("2026-09-29T09:00:00.000Z");
    expect(channels[0]?.members.map((m) => [m.userId, m.counting])).toEqual([
      ["u2", false],
      ["u1", true],
    ]);
  });
  test("AFKチャンネルの在室者は集計対象外", () => {
    const [channel] = groupActiveVoice({ u1: JSON.stringify(entry({ afk: true })) });
    expect(channel?.afk).toBe(true);
    expect(channel?.members[0]?.counting).toBe(false);
  });
  test("空なら空配列", () => {
    expect(groupActiveVoice({})).toEqual([]);
  });
});

describe("countingSince", () => {
  test("countingSinceの無い旧エントリはnullとして読む", () => {
    const legacy: Partial<ActiveVoiceEntry> = entry();
    delete legacy.countingSince;
    expect(parseActiveVoiceEntry(JSON.stringify(legacy))?.countingSince).toBeNull();
  });

  test("groupActiveVoiceはメンバーにcountingSinceを載せる", () => {
    const at = "2026-09-29T10:00:00.000Z";
    const [channel] = groupActiveVoice({ u1: JSON.stringify(entry({ countingSince: at })) });
    expect(channel?.members[0]?.countingSince).toBe(at);
  });
});
