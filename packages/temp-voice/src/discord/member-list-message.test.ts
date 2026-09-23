import { describe, expect, test } from "bun:test";
import { MessageFlags } from "discord.js";
import {
  buildMemberListMessage,
  buildRemoveMemberCustomId,
  buildRemoveMemberSuccessMessage,
  parseRemoveMemberCustomId,
} from "./member-list-message.js";

function hasFlag(flags: number, flag: number): boolean {
  return (flags & flag) === flag;
}

describe("buildRemoveMemberCustomId / parseRemoveMemberCustomId", () => {
  test("組み立ててパースすると元に戻る", () => {
    const customId = buildRemoveMemberCustomId("channel-1", "user", "user-1");
    expect(customId).toBe("temp-voice:removeMember:channel-1:user:user-1");
    expect(parseRemoveMemberCustomId(customId)).toEqual({ channelId: "channel-1", targetType: "user", targetId: "user-1" });
  });

  test("role対象も正しくパースする", () => {
    const customId = buildRemoveMemberCustomId("channel-1", "role", "role-1");
    expect(parseRemoveMemberCustomId(customId)).toEqual({ channelId: "channel-1", targetType: "role", targetId: "role-1" });
  });

  test("他のtemp-voice actionはnullを返す", () => {
    expect(parseRemoveMemberCustomId("temp-voice:rename:channel-1")).toBeNull();
  });

  test("targetTypeが不正な場合はnullを返す", () => {
    expect(parseRemoveMemberCustomId("temp-voice:removeMember:channel-1:invalid:user-1")).toBeNull();
  });
});

describe("buildMemberListMessage", () => {
  test("登録が無ければ「登録はありません」を表示する", () => {
    const message = buildMemberListMessage("channel-1", [], new Map());
    const text = JSON.stringify(message);
    expect(text).toContain("登録はありません");
  });

  test("登録済みoverrideごとに行を表示し、解除ボタンのcustomIdを持つ", () => {
    const overrides = [
      { channelId: "channel-1", targetType: "user" as const, targetId: "user-1", state: "allow" as const },
      { channelId: "channel-1", targetType: "role" as const, targetId: "role-1", state: "deny" as const },
    ];
    const targetNames = new Map([["user-1", "花子"], ["role-1", "モデレーター"]]);

    const message = buildMemberListMessage("channel-1", overrides, targetNames);
    const text = JSON.stringify(message);

    expect(text).toContain("花子");
    expect(text).toContain("モデレーター");
    expect(text).toContain("temp-voice:removeMember:channel-1:user:user-1");
    expect(text).toContain("temp-voice:removeMember:channel-1:role:role-1");
  });

  test("表示名が解決できなければtargetIdをそのまま表示する", () => {
    const overrides = [{ channelId: "channel-1", targetType: "user" as const, targetId: "unknown-user", state: "allow" as const }];

    const message = buildMemberListMessage("channel-1", overrides, new Map());
    const text = JSON.stringify(message);

    expect(text).toContain("unknown-user");
  });

  test("Components V2フラグとEphemeralフラグの両方を持つ(codexレビュー指摘: IsComponentsV2欠落でContainerが送信できなかった問題の回帰確認)", () => {
    const withOverrides = buildMemberListMessage(
      "channel-1",
      [{ channelId: "channel-1", targetType: "user" as const, targetId: "user-1", state: "allow" as const }],
      new Map(),
    );
    const empty = buildMemberListMessage("channel-1", [], new Map());

    for (const message of [withOverrides, empty]) {
      expect(hasFlag(message.flags, MessageFlags.IsComponentsV2)).toBe(true);
      expect(hasFlag(message.flags, MessageFlags.Ephemeral)).toBe(true);
    }
  });
});

describe("buildRemoveMemberSuccessMessage", () => {
  test("Components V2形式でcontentを持たない(codexレビュー指摘: content併用はComponents V2で送信エラーになる)", () => {
    const message = buildRemoveMemberSuccessMessage();

    expect(hasFlag(message.flags, MessageFlags.IsComponentsV2)).toBe(true);
    expect("content" in message).toBe(false);
    expect(JSON.stringify(message)).toContain("解除しました");
  });
});
