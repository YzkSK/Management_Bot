import { describe, expect, test } from "bun:test";
import { voiceSessionEndedSchema, moderationActionRecordedSchema, tempVoiceEventRecordedSchema } from "./domain-events.ts";

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
      incident: {
        violationType: "link_spam",
        score: 78,
        matchedMessageCount: 1,
        deletedMessageCount: 2,
        strikeCount: 3,
      },
      createdAt: "2026-08-29T00:00:00.000Z",
    });
    expect(result.actionType).toBe("ban");
    expect(result.incident).toEqual({
      violationType: "link_spam",
      score: 78,
      matchedMessageCount: 1,
      deletedMessageCount: 2,
      strikeCount: 3,
    });
  });

  test("raid incident retains severity and target count", () => {
    const result = moderationActionRecordedSchema.parse({
      type: "moderation.action.recorded",
      guildId: "1",
      caseId: "case-1",
      targetUserId: "2",
      moderatorId: "3",
      action: "create",
      actionType: "timeout",
      timeoutMinutes: 10,
      incident: {
        violationType: "raid",
        score: null,
        matchedMessageCount: 6,
        deletedMessageCount: 0,
        strikeCount: null,
        raidSeverity: "high",
        raidTargetCount: 6,
      },
      createdAt: "2026-08-29T00:00:00.000Z",
    });
    expect(result.incident.raidTargetCount).toBe(6);
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
      incident: {
        violationType: "link_spam",
        score: 78,
        matchedMessageCount: 1,
        deletedMessageCount: 2,
        strikeCount: 3,
      },
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

describe("tempVoiceEventRecordedSchema", () => {
  test("action=createdをparseできる(executorIdはオーナー入室起点のため未設定)", () => {
    const result = tempVoiceEventRecordedSchema.parse({
      type: "temp-voice.event.recorded",
      guildId: "1",
      channelId: "10",
      createdAt: "2026-09-22T00:00:00.000Z",
      action: "created",
      ownerId: "2",
      ownerName: "owner",
      controlChannelId: "11",
    });
    expect(result.action).toBe("created");
    expect(result.executorId).toBeUndefined();
  });

  test("action=deletedをparseできる", () => {
    const result = tempVoiceEventRecordedSchema.parse({
      type: "temp-voice.event.recorded",
      guildId: "1",
      channelId: "10",
      createdAt: "2026-09-22T00:00:00.000Z",
      action: "deleted",
      ownerId: "2",
    });
    expect(result.action).toBe("deleted");
  });

  test("action=renamedはbefore/afterを保持する", () => {
    const result = tempVoiceEventRecordedSchema.parse({
      type: "temp-voice.event.recorded",
      guildId: "1",
      channelId: "10",
      createdAt: "2026-09-22T00:00:00.000Z",
      action: "renamed",
      executorId: "2",
      before: "旧VC",
      after: "新VC",
    });
    expect(result.action).toBe("renamed");
    if (result.action === "renamed") {
      expect(result.before).toBe("旧VC");
      expect(result.after).toBe("新VC");
    }
  });

  test("action=permissionChangedはpermission/allowedを検証する", () => {
    const result = tempVoiceEventRecordedSchema.parse({
      type: "temp-voice.event.recorded",
      guildId: "1",
      channelId: "10",
      createdAt: "2026-09-22T00:00:00.000Z",
      action: "permissionChanged",
      executorId: "2",
      permission: "connect",
      allowed: false,
    });
    expect(result.action).toBe("permissionChanged");
  });

  test("action=permissionChangedで未知のpermissionは拒否する", () => {
    expect(() =>
      tempVoiceEventRecordedSchema.parse({
        type: "temp-voice.event.recorded",
        guildId: "1",
        channelId: "10",
        createdAt: "2026-09-22T00:00:00.000Z",
        action: "permissionChanged",
        permission: "speak",
        allowed: false,
      }),
    ).toThrow();
  });

  test("action=userLimitChanged/bitrateChangedはbefore/afterの整数を保持する", () => {
    const userLimit = tempVoiceEventRecordedSchema.parse({
      type: "temp-voice.event.recorded",
      guildId: "1",
      channelId: "10",
      createdAt: "2026-09-22T00:00:00.000Z",
      action: "userLimitChanged",
      executorId: "2",
      before: 0,
      after: 5,
    });
    expect(userLimit.action).toBe("userLimitChanged");

    const bitrate = tempVoiceEventRecordedSchema.parse({
      type: "temp-voice.event.recorded",
      guildId: "1",
      channelId: "10",
      createdAt: "2026-09-22T00:00:00.000Z",
      action: "bitrateChanged",
      executorId: "2",
      before: 64000,
      after: 96000,
    });
    expect(bitrate.action).toBe("bitrateChanged");
  });

  test("action=ownerTransferredはtrigger=manualでexecutorId=previousOwnerIdを設定できる", () => {
    const result = tempVoiceEventRecordedSchema.parse({
      type: "temp-voice.event.recorded",
      guildId: "1",
      channelId: "10",
      createdAt: "2026-09-22T00:00:00.000Z",
      action: "ownerTransferred",
      executorId: "2",
      previousOwnerId: "2",
      newOwnerId: "3",
      trigger: "manual",
    });
    expect(result.action).toBe("ownerTransferred");
    if (result.action === "ownerTransferred") {
      expect(result.trigger).toBe("manual");
    }
  });

  test("action=ownerTransferredはtrigger=autoGraceExpiredでexecutorId未設定を許容する(システム起因)", () => {
    const result = tempVoiceEventRecordedSchema.parse({
      type: "temp-voice.event.recorded",
      guildId: "1",
      channelId: "10",
      createdAt: "2026-09-22T00:00:00.000Z",
      action: "ownerTransferred",
      previousOwnerId: "2",
      newOwnerId: "3",
      trigger: "autoGraceExpired",
    });
    expect(result.executorId).toBeUndefined();
  });

  test("action=memberPermissionChangedはstate=clearedを含む3状態を検証する", () => {
    for (const state of ["allow", "deny", "cleared"] as const) {
      const result = tempVoiceEventRecordedSchema.parse({
        type: "temp-voice.event.recorded",
        guildId: "1",
        channelId: "10",
        createdAt: "2026-09-22T00:00:00.000Z",
        action: "memberPermissionChanged",
        executorId: "2",
        state,
        targetType: "role",
        targetId: "99",
      });
      expect(result.action).toBe("memberPermissionChanged");
    }
  });

  test("未知のactionは拒否する", () => {
    expect(() =>
      tempVoiceEventRecordedSchema.parse({
        type: "temp-voice.event.recorded",
        guildId: "1",
        channelId: "10",
        createdAt: "2026-09-22T00:00:00.000Z",
        action: "locked",
        executorId: "2",
      }),
    ).toThrow();
  });
});
