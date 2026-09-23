import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  TEMP_VOICE_CREATE_REASON,
  TEMP_VOICE_CONTROL_CREATE_REASON,
  TEMP_VOICE_DELETE_REASON,
  TEMP_VOICE_UPDATE_REASON,
  isTempVoiceAuditReason,
  suppressTempVoiceChannelLog,
  shouldSuppressTempVoiceChannelLog,
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
