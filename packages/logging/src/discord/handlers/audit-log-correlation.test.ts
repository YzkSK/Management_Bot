import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import { AuditLogEvent } from "discord.js";
import { registerAuditLogCorrelationHandlers, toAuditLogEntryInfo } from "./audit-log-correlation.js";

function fakeAuditLogEntry(overrides: Partial<{ id: string; action: AuditLogEvent; executorId: string | null; targetId: string | null }> = {}) {
  return {
    id: "audit-1",
    action: AuditLogEvent.ChannelDelete,
    executorId: "u1",
    targetId: "c1",
    createdAt: new Date("2026-08-31T00:00:00.000Z"),
    ...overrides,
  } as never;
}

describe("toAuditLogEntryInfo", () => {
  test("既知のactionは名前文字列に変換する", () => {
    const info = toAuditLogEntryInfo(fakeAuditLogEntry({ action: AuditLogEvent.ChannelDelete }), "g1");
    expect(info).toEqual({
      id: "audit-1",
      guildId: "g1",
      action: "ChannelDelete",
      executorId: "u1",
      targetId: "c1",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
  });

  test("未知のaction数値は数値文字列にフォールバックする", () => {
    const info = toAuditLogEntryInfo(fakeAuditLogEntry({ action: 9999 as AuditLogEvent }), "g1");
    expect(info.action).toBe("9999");
  });
});

describe("registerAuditLogCorrelationHandlers", () => {
  test("guildAuditLogEntryCreateをclient.onに登録する", () => {
    const on = mock(() => undefined);
    const ctx = { client: { on }, db: {} } as unknown as FeatureModuleContext;

    registerAuditLogCorrelationHandlers(ctx);

    expect(on.mock.calls.map((call) => call[0])).toEqual(["guildAuditLogEntryCreate"]);
  });
});
