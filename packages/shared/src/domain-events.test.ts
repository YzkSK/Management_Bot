import { describe, expect, test } from "bun:test";
import { voiceSessionEndedSchema, moderationActionRecordedSchema } from "./domain-events.ts";

describe("voiceSessionEndedSchema", () => {
  test("正しいpayloadをparseできる", () => {
    const result = voiceSessionEndedSchema.parse({
      type: "voice.session.ended",
      guildId: "1",
      userId: "2",
      channelId: "3",
      startedAt: "2026-08-29T00:00:00.000Z",
      endedAt: "2026-08-29T00:10:00.000Z",
      durationSeconds: 600,
    });
    expect(result.durationSeconds).toBe(600);
  });

  test("負のdurationSecondsは拒否する", () => {
    expect(() =>
      voiceSessionEndedSchema.parse({
        type: "voice.session.ended",
        guildId: "1",
        userId: "2",
        channelId: "3",
        startedAt: "2026-08-29T00:00:00.000Z",
        endedAt: "2026-08-29T00:10:00.000Z",
        durationSeconds: -1,
      }),
    ).toThrow();
  });

  test("endedAtがstartedAtより前の場合は拒否する", () => {
    expect(() =>
      voiceSessionEndedSchema.parse({
        type: "voice.session.ended",
        guildId: "1",
        userId: "2",
        channelId: "3",
        startedAt: "2026-08-29T00:10:00.000Z",
        endedAt: "2026-08-29T00:00:00.000Z",
        durationSeconds: 0,
      }),
    ).toThrow();
  });
});

describe("moderationActionRecordedSchema", () => {
  test("正しいpayloadをparseできる", () => {
    const result = moderationActionRecordedSchema.parse({
      type: "moderation.action.recorded",
      guildId: "1",
      caseId: "case-1",
      targetUserId: "2",
      moderatorId: "3",
      action: "create",
      actionType: "ban",
      createdAt: "2026-08-29T00:00:00.000Z",
    });
    expect(result.actionType).toBe("ban");
  });

  test("未知のactionTypeは拒否する", () => {
    expect(() =>
      moderationActionRecordedSchema.parse({
        type: "moderation.action.recorded",
        guildId: "1",
        caseId: "case-1",
        targetUserId: "2",
        moderatorId: "3",
        action: "create",
        actionType: "notAnActionType",
        createdAt: "2026-08-29T00:00:00.000Z",
      }),
    ).toThrow();
  });

  test("action=resolveはresultを含めてparseできる", () => {
    const result = moderationActionRecordedSchema.parse({
      type: "moderation.action.recorded",
      guildId: "1",
      caseId: "case-1",
      targetUserId: "2",
      moderatorId: "3",
      action: "resolve",
      actionType: "ban",
      result: "failed",
      failureCode: "member_not_found",
      createdAt: "2026-08-29T00:00:00.000Z",
    });
    expect(result.action).toBe("resolve");
    if (result.action === "resolve") {
      expect(result.result).toBe("failed");
      expect(result.failureCode).toBe("member_not_found");
    }
  });

  test("action=resolveでresultが欠けている場合は拒否する", () => {
    expect(() =>
      moderationActionRecordedSchema.parse({
        type: "moderation.action.recorded",
        guildId: "1",
        caseId: "case-1",
        targetUserId: "2",
        moderatorId: "3",
        action: "resolve",
        actionType: "ban",
        createdAt: "2026-08-29T00:00:00.000Z",
      }),
    ).toThrow();
  });

  test("action=updateは拒否する(未使用のため選択肢から除外)", () => {
    expect(() =>
      moderationActionRecordedSchema.parse({
        type: "moderation.action.recorded",
        guildId: "1",
        caseId: "case-1",
        targetUserId: "2",
        moderatorId: "3",
        action: "update",
        actionType: "ban",
        createdAt: "2026-08-29T00:00:00.000Z",
      }),
    ).toThrow();
  });
});
