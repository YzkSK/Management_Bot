import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import { AuditLogEvent } from "discord.js";
import { registerAuditLogCorrelationHandlers, toAuditLogEntryInfo } from "./audit-log-correlation.js";

function fakeAuditLogEntry(
  overrides: Partial<{
    id: string;
    action: AuditLogEvent;
    executorId: string | null;
    targetId: string | null;
    changes: { key: string; new?: { id: string; name: string }[] }[];
    extra: unknown;
  }> = {},
) {
  return {
    id: "audit-1",
    action: AuditLogEvent.ChannelDelete,
    executorId: "u1",
    targetId: "c1",
    createdAt: new Date("2026-08-31T00:00:00.000Z"),
    changes: [],
    extra: null,
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

  test("MemberRoleUpdateはchangesの$add/$removeからroleIdの集合を抽出する", () => {
    const info = toAuditLogEntryInfo(
      fakeAuditLogEntry({
        action: AuditLogEvent.MemberRoleUpdate,
        changes: [
          { key: "$add", new: [{ id: "r1", name: "Role1" }] },
          { key: "$remove", new: [{ id: "r2", name: "Role2" }] },
        ],
      }),
      "g1",
    );
    expect(info.roleChanges).toEqual({ added: ["r1"], removed: ["r2"] });
  });

  test("MemberRoleUpdate以外はroleChangesがundefinedになる", () => {
    const info = toAuditLogEntryInfo(fakeAuditLogEntry({ action: AuditLogEvent.ChannelDelete }), "g1");
    expect(info.roleChanges).toBeUndefined();
  });

  test("MessageDeleteはextra.channel.idをmessageDeleteChannelIdとして抽出する", () => {
    const info = toAuditLogEntryInfo(
      fakeAuditLogEntry({ action: AuditLogEvent.MessageDelete, extra: { channel: { id: "c1" }, count: 1 } }),
      "g1",
    );
    expect(info.messageDeleteChannelId).toBe("c1");
  });

  test("MessageDelete以外はmessageDeleteChannelIdがundefinedになる", () => {
    const info = toAuditLogEntryInfo(fakeAuditLogEntry({ action: AuditLogEvent.ChannelDelete }), "g1");
    expect(info.messageDeleteChannelId).toBeUndefined();
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
