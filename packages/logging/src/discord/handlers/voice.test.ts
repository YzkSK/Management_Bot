import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import { registerVoiceHandlers, toVoiceStateLogEntry } from "./voice.js";

function fakeVoiceState(channelId: string | null) {
  return { id: "u1", channelId, guild: { id: "g1" } } as never;
}

describe("toVoiceStateLogEntry", () => {
  test("未参加→参加はjoin", () => {
    const entry = toVoiceStateLogEntry(fakeVoiceState(null), fakeVoiceState("c1"));
    expect(entry).toMatchObject({ category: "voice", action: "join", channelId: "c1", userId: "u1" });
  });

  test("参加→未参加はleave(退室元のチャンネルIDを記録)", () => {
    const entry = toVoiceStateLogEntry(fakeVoiceState("c1"), fakeVoiceState(null));
    expect(entry).toMatchObject({ category: "voice", action: "leave", channelId: "c1" });
  });

  test("チャンネル間の異動はmove(移動先channelId・移動元previousChannelId)", () => {
    const entry = toVoiceStateLogEntry(fakeVoiceState("c1"), fakeVoiceState("c2"));
    expect(entry).toMatchObject({ category: "voice", action: "move", channelId: "c2", previousChannelId: "c1" });
  });

  test("同一チャンネル内の変更(ミュート等)はundefined", () => {
    expect(toVoiceStateLogEntry(fakeVoiceState("c1"), fakeVoiceState("c1"))).toBeUndefined();
  });

  test("未参加のまま変化なしもundefined", () => {
    expect(toVoiceStateLogEntry(fakeVoiceState(null), fakeVoiceState(null))).toBeUndefined();
  });
});

describe("registerVoiceHandlers", () => {
  test("voiceStateUpdateをclient.onに登録する", () => {
    const on = mock(() => undefined);
    const ctx = { client: { on }, db: {} } as unknown as FeatureModuleContext;

    registerVoiceHandlers(ctx);

    expect(on.mock.calls.map((call) => call[0])).toEqual(["voiceStateUpdate"]);
  });
});
