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
    target: unknown;
    changes: { key: string; new?: { id: string; name: string }[] | boolean | string; old?: string }[];
    extra: unknown;
  }> = {},
) {
  return {
    id: "audit-1",
    action: AuditLogEvent.ChannelDelete,
    executorId: "u1",
    targetId: "c1",
    target: null,
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

  test("executorのギルド表示名(ニックネーム優先)が渡されればexecutorNameに設定する", () => {
    const info = toAuditLogEntryInfo(fakeAuditLogEntry({}), "g1", "モデレーター太郎(ニックネーム)");
    expect(info.executorName).toBe("モデレーター太郎(ニックネーム)");
  });

  test("ギルド表示名が渡されない場合はexecutorNameを設定しない(既存のresolveDisplayNamesへフォールバック)", () => {
    const info = toAuditLogEntryInfo(fakeAuditLogEntry({}), "g1");
    expect(info.executorName).toBeUndefined();
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

  test("InviteCreateはtargetIdがnullでもentry.target.codeをtargetIdとして使う(Discord APIの仕様上target_idは常にnullのため)", () => {
    const info = toAuditLogEntryInfo(
      fakeAuditLogEntry({ action: AuditLogEvent.InviteCreate, targetId: null, target: { code: "abc123" } }),
      "g1",
    );
    expect(info.targetId).toBe("abc123");
  });

  test("InviteDeleteも同様にentry.target.codeをtargetIdとして使う", () => {
    const info = toAuditLogEntryInfo(
      fakeAuditLogEntry({ action: AuditLogEvent.InviteDelete, targetId: null, target: { code: "abc123" } }),
      "g1",
    );
    expect(info.targetId).toBe("abc123");
  });

  test("InviteCreateでtargetにcodeがない場合はentry.targetIdへフォールバックする", () => {
    const info = toAuditLogEntryInfo(
      fakeAuditLogEntry({ action: AuditLogEvent.InviteCreate, targetId: "legacy-target", target: null }),
      "g1",
    );
    expect(info.targetId).toBe("legacy-target");
  });

  test("InviteCreateでtarget.codeが空文字/非文字列の場合もentry.targetIdへフォールバックする", () => {
    expect(
      toAuditLogEntryInfo(
        fakeAuditLogEntry({ action: AuditLogEvent.InviteCreate, targetId: "legacy-target", target: { code: "" } }),
        "g1",
      ).targetId,
    ).toBe("legacy-target");
    expect(
      toAuditLogEntryInfo(
        fakeAuditLogEntry({ action: AuditLogEvent.InviteCreate, targetId: "legacy-target", target: { code: 123 } }),
        "g1",
      ).targetId,
    ).toBe("legacy-target");
  });

  test("InviteCreate/InviteDelete以外ではentry.targetIdをそのまま使う(entry.targetにcodeがあっても無視する)", () => {
    const info = toAuditLogEntryInfo(
      fakeAuditLogEntry({ action: AuditLogEvent.ChannelDelete, targetId: "c1", target: { code: "abc123" } }),
      "g1",
    );
    expect(info.targetId).toBe("c1");
  });

  test("MemberDisconnectはextra.countをvoiceDisconnectOrMoveとして抽出する", () => {
    const info = toAuditLogEntryInfo(
      fakeAuditLogEntry({ action: AuditLogEvent.MemberDisconnect, extra: { count: 1 } }),
      "g1",
    );
    expect(info.voiceDisconnectOrMove).toEqual({ count: 1, moveChannelId: undefined });
  });

  test("MemberMoveはextra.countとextra.channel.id(移動先)をvoiceDisconnectOrMoveとして抽出する", () => {
    const info = toAuditLogEntryInfo(
      fakeAuditLogEntry({ action: AuditLogEvent.MemberMove, extra: { count: 1, channel: { id: "c2" } } }),
      "g1",
    );
    expect(info.voiceDisconnectOrMove).toEqual({ count: 1, moveChannelId: "c2" });
  });

  test("MemberUpdateはchangesのmute/deafをmemberUpdateVoiceStateChangesとして抽出する(mute/deafのみ→hasOtherChanges=false)", () => {
    const info = toAuditLogEntryInfo(
      fakeAuditLogEntry({
        action: AuditLogEvent.MemberUpdate,
        changes: [
          { key: "mute", new: true },
          { key: "deaf", new: false },
        ],
      }),
      "g1",
    );
    expect(info.memberUpdateVoiceStateChanges).toEqual({ mute: true, deaf: false, hasOtherChanges: false });
  });

  test("MemberUpdateでmute/deafと同時にnickname等の変更がある場合はhasOtherChanges=trueになる", () => {
    const info = toAuditLogEntryInfo(
      fakeAuditLogEntry({
        action: AuditLogEvent.MemberUpdate,
        changes: [
          { key: "mute", new: true },
          { key: "nick", new: undefined },
        ],
      }),
      "g1",
    );
    expect(info.memberUpdateVoiceStateChanges).toEqual({ mute: true, deaf: undefined, hasOtherChanges: true });
  });

  test("MemberUpdateでmute/deaf以外の変更(nicknameChange等)のみの場合はmemberUpdateVoiceStateChangesがundefinedになる", () => {
    const info = toAuditLogEntryInfo(
      fakeAuditLogEntry({ action: AuditLogEvent.MemberUpdate, changes: [{ key: "nick", new: undefined }] }),
      "g1",
    );
    expect(info.memberUpdateVoiceStateChanges).toBeUndefined();
  });

  test("MemberUpdateのnick差分と対象ユーザーの本来の表示名を抽出する", () => {
    const info = toAuditLogEntryInfo(
      fakeAuditLogEntry({
        action: AuditLogEvent.MemberUpdate,
        targetId: "u1",
        target: { displayName: "Yuzuki" },
        changes: [{ key: "nick", old: "Yzk", new: "Yuzuki" }],
      }),
      "g1",
    );

    expect(info.memberNicknameChange).toEqual({ before: "Yzk", after: "Yuzuki", previousUserName: "Yuzuki" });
  });

  test("MemberUpdateのnick初回設定では変更前をnullとして本来の表示名を保存する", () => {
    const info = toAuditLogEntryInfo(
      fakeAuditLogEntry({
        action: AuditLogEvent.MemberUpdate,
        targetId: "u1",
        target: { displayName: "Yuzuki" },
        changes: [{ key: "nick", new: "Yzk" }],
      }),
      "g1",
    );

    expect(info.memberNicknameChange).toEqual({ before: null, after: "Yzk", previousUserName: "Yuzuki" });
  });

  test("MemberUpdate以外はmemberUpdateVoiceStateChangesがundefinedになる", () => {
    const info = toAuditLogEntryInfo(fakeAuditLogEntry({ action: AuditLogEvent.ChannelDelete }), "g1");
    expect(info.memberUpdateVoiceStateChanges).toBeUndefined();
  });

  test("MemberDisconnect/MemberMove以外はvoiceDisconnectOrMoveがundefinedになる", () => {
    const info = toAuditLogEntryInfo(fakeAuditLogEntry({ action: AuditLogEvent.ChannelDelete }), "g1");
    expect(info.voiceDisconnectOrMove).toBeUndefined();
  });

  test("MemberDisconnectでextra.countが数値でない場合はundefinedを返す", () => {
    const info = toAuditLogEntryInfo(fakeAuditLogEntry({ action: AuditLogEvent.MemberDisconnect, extra: null }), "g1");
    expect(info.voiceDisconnectOrMove).toBeUndefined();
  });

  test("MessageDeleteでextraがnull/channel欠損でも例外を投げずundefinedを返す(監査ログのoptional infoは仕様上欠損し得るため)", () => {
    expect(
      toAuditLogEntryInfo(fakeAuditLogEntry({ action: AuditLogEvent.MessageDelete, extra: null }), "g1")
        .messageDeleteChannelId,
    ).toBeUndefined();
    expect(
      toAuditLogEntryInfo(fakeAuditLogEntry({ action: AuditLogEvent.MessageDelete, extra: {} }), "g1")
        .messageDeleteChannelId,
    ).toBeUndefined();
    expect(
      toAuditLogEntryInfo(fakeAuditLogEntry({ action: AuditLogEvent.MessageDelete, extra: { channel: {} } }), "g1")
        .messageDeleteChannelId,
    ).toBeUndefined();
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
