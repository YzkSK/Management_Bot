import { describe, expect, test } from "bun:test";
import { buildMemberListMessage, buildRemoveMemberCustomId, parseRemoveMemberCustomId } from "./member-list-message.js";

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
});
