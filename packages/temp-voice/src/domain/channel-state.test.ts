import { describe, expect, test } from "bun:test";
import {
  parseTempVoiceChannelState,
  parseTempVoiceStateHash,
  serializeTempVoiceChannelState,
  tempVoiceStateKey,
  type TempVoiceChannelState,
} from "./channel-state.js";

const state: TempVoiceChannelState = {
  userLimit: 5,
  bitrate: 64000,
  isLocked: true,
  isHidden: false,
  members: [
    {
      userId: "u1",
      name: "Alice",
      avatarUrl: null,
      selfMute: true,
      serverMute: false,
      selfDeaf: false,
      serverDeaf: false,
      streaming: false,
      video: true,
    },
  ],
};

describe("temp voice channel state", () => {
  test("キーはギルド単位", () => {
    expect(tempVoiceStateKey("g1")).toBe("temp-voice:state:g1");
  });

  test("シリアライズした値をパースすると元に戻る", () => {
    expect(parseTempVoiceChannelState(serializeTempVoiceChannelState(state))).toEqual(state);
  });

  test("不正なスキーマの書き込みは例外になる", () => {
    expect(() => serializeTempVoiceChannelState({ ...state, userLimit: "5" } as never)).toThrow();
  });

  test("壊れたJSON・不正な形・文字列以外は捨てる", () => {
    expect(parseTempVoiceChannelState("{")).toBeUndefined();
    expect(parseTempVoiceChannelState(JSON.stringify({ userLimit: 1 }))).toBeUndefined();
    expect(parseTempVoiceChannelState(null)).toBeUndefined();
  });

  test("Hash全体のパースは不正なエントリだけ捨てる", () => {
    const map = parseTempVoiceStateHash({ c1: serializeTempVoiceChannelState(state), c2: "broken" });
    expect([...map.keys()]).toEqual(["c1"]);
  });
});
