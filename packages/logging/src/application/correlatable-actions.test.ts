import { describe, expect, test } from "bun:test";
import type { LogEntry } from "../domain/index.js";
import { CORRELATION_RULES } from "./correlate-audit-log-entry.js";
import { isCorrelatable } from "./correlatable-actions.js";

describe("isCorrelatable", () => {
  test("CORRELATION_RULESの全エントリのcategory/logActionsはisCorrelatable=trueになる(手動リストとの同期チェック)", () => {
    for (const rule of Object.values(CORRELATION_RULES)) {
      if (!rule) continue;
      for (const action of rule.logActions) {
        const entry = { category: rule.category, action } as unknown as LogEntry;
        expect(isCorrelatable(entry), `${rule.category}/${action}`).toBe(true);
      }
    }
  });

  test("MemberRoleUpdate相当(role/memberAdd,memberRemove)はtrue", () => {
    expect(isCorrelatable({ category: "role", action: "memberAdd" } as unknown as LogEntry)).toBe(true);
    expect(isCorrelatable({ category: "role", action: "memberRemove" } as unknown as LogEntry)).toBe(true);
  });

  test("MessageDelete相当(message/delete)はtrue", () => {
    expect(isCorrelatable({ category: "message", action: "delete" } as unknown as LogEntry)).toBe(true);
  });

  test("MemberDisconnect/MemberMove/MemberUpdate voiceState相当(voice/leave,move,update)はtrue", () => {
    expect(isCorrelatable({ category: "voice", action: "leave" } as unknown as LogEntry)).toBe(true);
    expect(isCorrelatable({ category: "voice", action: "move" } as unknown as LogEntry)).toBe(true);
    expect(isCorrelatable({ category: "voice", action: "update" } as unknown as LogEntry)).toBe(true);
  });

  test("member/leaveはMemberKick相当でkickに書き換わり得るためtrue", () => {
    expect(isCorrelatable({ category: "member", action: "leave" } as unknown as LogEntry)).toBe(true);
  });

  test("相関対象外のaction(member/join, message/create等)はfalse", () => {
    expect(isCorrelatable({ category: "member", action: "join" } as unknown as LogEntry)).toBe(false);
    expect(isCorrelatable({ category: "message", action: "create" } as unknown as LogEntry)).toBe(false);
    expect(isCorrelatable({ category: "message", action: "bulkDelete" } as unknown as LogEntry)).toBe(false);
    expect(isCorrelatable({ category: "voice", action: "join" } as unknown as LogEntry)).toBe(false);
    expect(isCorrelatable({ category: "reaction", action: "add" } as unknown as LogEntry)).toBe(false);
  });

  test("相関対象外のカテゴリ(reaction, poll, auditLogCorrelation, moderationCase)はfalse", () => {
    expect(isCorrelatable({ category: "poll", action: "create" } as unknown as LogEntry)).toBe(false);
    expect(
      isCorrelatable({ category: "auditLogCorrelation", actionType: "x" } as unknown as LogEntry),
    ).toBe(false);
    expect(isCorrelatable({ category: "moderationCase", action: "create" } as unknown as LogEntry)).toBe(false);
  });
});
