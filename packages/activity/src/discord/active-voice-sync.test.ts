import { describe, expect, test } from "bun:test";
import { toActiveVoiceEntry } from "./active-voice-sync.js";

const base = {
  id: "u1",
  channelId: "c1",
  channel: { name: "雑談VC" },
  guild: { id: "g1", afkChannelId: "afk" },
  member: { displayName: "Alice", displayAvatarURL: () => "https://cdn/a.png", user: { bot: false } },
  selfMute: false,
  selfDeaf: false,
  serverMute: false,
  serverDeaf: false,
  streaming: false,
  selfVideo: true,
};

describe("toActiveVoiceEntry", () => {
  test("在室中のVoiceStateを表示用エントリへ変換する", () => {
    expect(toActiveVoiceEntry(base, "2026-09-29T10:00:00.000Z")).toEqual({
      channelId: "c1",
      channelName: "雑談VC",
      afk: false,
      name: "Alice",
      avatarUrl: "https://cdn/a.png",
      joinedAt: "2026-09-29T10:00:00.000Z",
      selfMute: false,
      selfDeaf: false,
      serverMute: false,
      serverDeaf: false,
      streaming: false,
      video: true,
    });
  });
  test("AFKチャンネルならafk=true", () => {
    expect(toActiveVoiceEntry({ ...base, channelId: "afk" }, "2026-09-29T10:00:00.000Z")?.afk).toBe(true);
  });
  test("退室(チャンネルなし)・メンバー不明はundefined", () => {
    expect(toActiveVoiceEntry({ ...base, channelId: null, channel: null }, "x")).toBeUndefined();
    expect(toActiveVoiceEntry({ ...base, member: null }, "x")).toBeUndefined();
  });
});
