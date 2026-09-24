import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  TEMP_VOICE_CREATE_REASON,
  TEMP_VOICE_CONTROL_CREATE_REASON,
  TEMP_VOICE_DELETE_REASON,
  TEMP_VOICE_UPDATE_REASON,
  isTempVoiceAuditReason,
  shouldSuppressTempVoiceChannelCreateLog,
  suppressTempVoiceChannelLog,
  suppressTempVoiceChannelCreateLog,
  shouldSuppressTempVoiceChannelLog,
  shouldSuppressTempVoiceMoveLog,
  suppressTempVoiceMoveLog,
} from "./log-suppression.ts";

describe("isTempVoiceAuditReason", () => {
  test("4つの固定reason文字列すべてを一時VC由来と判定する", () => {
    for (const reason of [
      TEMP_VOICE_CREATE_REASON,
      TEMP_VOICE_CONTROL_CREATE_REASON,
      TEMP_VOICE_DELETE_REASON,
      TEMP_VOICE_UPDATE_REASON,
    ]) {
      expect(isTempVoiceAuditReason(reason)).toBe(true);
    }
  });

  test("null/undefined/無関係な文字列はfalse", () => {
    expect(isTempVoiceAuditReason(null)).toBe(false);
    expect(isTempVoiceAuditReason(undefined)).toBe(false);
    expect(isTempVoiceAuditReason("some other reason")).toBe(false);
  });
});

describe("suppressTempVoiceChannelLog / shouldSuppressTempVoiceChannelLog", () => {
  test("抑制登録したchannelIdはshouldSuppressがtrueを返す", () => {
    const channelId = randomUUID();
    suppressTempVoiceChannelLog(channelId);
    expect(shouldSuppressTempVoiceChannelLog(channelId)).toBe(true);
  });

  test("チェック時に消費される(2回目はfalse)", () => {
    const channelId = randomUUID();
    suppressTempVoiceChannelLog(channelId);
    expect(shouldSuppressTempVoiceChannelLog(channelId)).toBe(true);
    expect(shouldSuppressTempVoiceChannelLog(channelId)).toBe(false);
  });

  test("登録していないchannelIdはfalse", () => {
    expect(shouldSuppressTempVoiceChannelLog(randomUUID())).toBe(false);
  });

  test("TTL経過後はfalse(消費もされる)", () => {
    const channelId = randomUUID();
    suppressTempVoiceChannelLog(channelId, -1);
    expect(shouldSuppressTempVoiceChannelLog(channelId)).toBe(false);
    expect(shouldSuppressTempVoiceChannelLog(channelId)).toBe(false);
  });
});

describe("suppressTempVoiceChannelCreateLog / shouldSuppressTempVoiceChannelCreateLog", () => {
  const createInput = { guildId: "g1", parentId: "category-1", channelType: 2, name: "miniのVC" };

  test("一致する作成だけを一回抑制する", () => {
    suppressTempVoiceChannelCreateLog(createInput);
    expect(shouldSuppressTempVoiceChannelCreateLog(createInput)).toBe(true);
    expect(shouldSuppressTempVoiceChannelCreateLog(createInput)).toBe(false);
  });

  test("属性が異なる作成は抑制しない", () => {
    suppressTempVoiceChannelCreateLog(createInput);
    expect(shouldSuppressTempVoiceChannelCreateLog({ ...createInput, channelType: 0 })).toBe(false);
    expect(shouldSuppressTempVoiceChannelCreateLog(createInput)).toBe(true);
  });
});

describe("suppressTempVoiceMoveLog / shouldSuppressTempVoiceMoveLog", () => {
  const moveInput = { guildId: "g1", userId: "user-1", previousChannelId: "create-1", channelId: "temp-1" };

  test("一致するBot移動だけを一回抑制する", () => {
    suppressTempVoiceMoveLog(moveInput);
    expect(shouldSuppressTempVoiceMoveLog(moveInput)).toBe(true);
    expect(shouldSuppressTempVoiceMoveLog(moveInput)).toBe(false);
  });

  test("移動先が異なる通常移動は抑制しない", () => {
    suppressTempVoiceMoveLog(moveInput);
    expect(shouldSuppressTempVoiceMoveLog({ ...moveInput, channelId: "other-1" })).toBe(false);
    expect(shouldSuppressTempVoiceMoveLog(moveInput)).toBe(true);
  });
});
