import { describe, expect, test } from "bun:test";
import { getLogEntrySubjectId } from "./log-entry-subject.js";
import type { LogEntry } from "./log-entry.js";

describe("getLogEntrySubjectId", () => {
  test("messageはauthorIdを返す", () => {
    const entry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      channelId: "c1",
      authorId: "a1",
      action: "delete",
    } satisfies LogEntry;
    expect(getLogEntrySubjectId(entry)).toBe("a1");
  });

  test("memberはuserIdを返す", () => {
    const entry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      action: "join",
    } satisfies LogEntry;
    expect(getLogEntrySubjectId(entry)).toBe("u1");
  });

  test("moderationCaseはtargetUserIdを返す(moderatorIdではない)", () => {
    const entry = {
      category: "moderationCase",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      caseId: "case1",
      targetUserId: "target1",
      moderatorId: "mod1",
      action: "create",
      actionType: "warn",
    } satisfies LogEntry;
    expect(getLogEntrySubjectId(entry)).toBe("target1");
  });

  test("roleはuserId未設定(create/update/delete)ならundefined", () => {
    const entry = {
      category: "role",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      roleId: "r1",
      action: "update",
    } satisfies LogEntry;
    expect(getLogEntrySubjectId(entry)).toBeUndefined();
  });

  test("guildはundefined(ユーザーIDを持たないカテゴリ)", () => {
    const entry = {
      category: "guild",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      action: "update",
    } satisfies LogEntry;
    expect(getLogEntrySubjectId(entry)).toBeUndefined();
  });

  test("voiceはuserIdを返す", () => {
    const entry = {
      category: "voice",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      channelId: "c1",
      action: "join",
    } satisfies LogEntry;
    expect(getLogEntrySubjectId(entry)).toBe("u1");
  });

  test("autoModはuserIdを返す", () => {
    const entry = {
      category: "autoMod",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      ruleId: "rule1",
      userId: "u1",
      action: "actionExecuted",
    } satisfies LogEntry;
    expect(getLogEntrySubjectId(entry)).toBe("u1");
  });
});
