import { describe, expect, test } from "bun:test";
import {
  buildSelectPermissionMessage,
  buildTempVoiceSelectCustomId,
  parseTempVoiceSelectCustomId,
} from "./select-permission-message.js";

describe("buildTempVoiceSelectCustomId / parseTempVoiceSelectCustomId", () => {
  test("customIdを組み立ててパースすると元に戻る", () => {
    const customId = buildTempVoiceSelectCustomId("permitMemberUser", "channel-1");
    expect(customId).toBe("temp-voice:permitMemberUser:channel-1");
    expect(parseTempVoiceSelectCustomId(customId)).toEqual({ action: "permitMemberUser", channelId: "channel-1" });
  });

  test("ボタン用actionはnullを返す(混同防止)", () => {
    expect(parseTempVoiceSelectCustomId("temp-voice:rename:channel-1")).toBeNull();
  });

  test("prefixが違うcustomIdはnullを返す", () => {
    expect(parseTempVoiceSelectCustomId("other:permitMemberUser:1")).toBeNull();
  });
});

describe("buildSelectPermissionMessage", () => {
  test("permitモードはpermitMemberUser/permitMemberRoleのcustomIdを持つ", () => {
    const message = buildSelectPermissionMessage("permit", "channel-1");
    const text = JSON.stringify(message);
    expect(text).toContain("temp-voice:permitMemberUser:channel-1");
    expect(text).toContain("temp-voice:permitMemberRole:channel-1");
  });

  test("denyモードはdenyMemberUser/denyMemberRoleのcustomIdを持つ", () => {
    const message = buildSelectPermissionMessage("deny", "channel-1");
    const text = JSON.stringify(message);
    expect(text).toContain("temp-voice:denyMemberUser:channel-1");
    expect(text).toContain("temp-voice:denyMemberRole:channel-1");
  });

  test("ephemeralフラグ(64)を含む", () => {
    const message = buildSelectPermissionMessage("permit", "channel-1");
    const flags = Number(message.flags);
    expect(Number.isInteger(flags) && (flags & 64) === 64).toBe(true);
  });
});
