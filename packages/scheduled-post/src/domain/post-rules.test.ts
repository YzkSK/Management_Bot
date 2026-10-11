import { describe, expect, test } from "bun:test";
import {
  buildAdminCancelDm,
  buildFailureDm,
  buildMentionMessage,
  checkLimits,
  classifySendErrorCode,
  decidePostability,
  validateMentionSelection,
  type MentionPolicy,
  type MentionSelection,
  type PostFacts,
} from "./post-rules.js";

const okFacts: PostFacts = {
  authorIsMember: true,
  authorRoleIds: ["r1"],
  channelKind: "message-channel",
  threadClosed: false,
  authorCanSend: true,
  botCanSend: true,
};

describe("checkLimits", () => {
  test("1人10件・1ギルド100件に達したらエラー", () => {
    expect(checkLimits({ userPending: 9, guildPending: 99 })).toBeNull();
    expect(checkLimits({ userPending: 10, guildPending: 10 })).toBe("user_limit");
    expect(checkLimits({ userPending: 0, guildPending: 100 })).toBe("guild_limit");
  });
});

describe("decidePostability", () => {
  test("すべて満たせば投稿可", () => {
    expect(decidePostability(okFacts, [])).toEqual({ ok: true });
    expect(decidePostability({ ...okFacts, channelKind: "thread" }, ["r1", "r2"])).toEqual({ ok: true });
  });

  test("原因ごとに失敗コードを返す", () => {
    const reason = (patch: Partial<PostFacts>, roles: string[] = []) => {
      const result = decidePostability({ ...okFacts, ...patch }, roles);
      return result.ok ? "ok" : result.reason;
    };
    expect(reason({ authorIsMember: false })).toBe("author_left");
    expect(reason({ channelKind: "missing" })).toBe("channel_deleted");
    expect(reason({ channelKind: "unsupported" })).toBe("channel_deleted");
    expect(reason({ channelKind: "thread", threadClosed: true })).toBe("thread_archived");
    expect(reason({ authorCanSend: false })).toBe("no_permission");
    expect(reason({ authorRoleIds: ["other"] }, ["r1"])).toBe("no_role");
    expect(reason({ botCanSend: false })).toBe("bot_missing_permission");
  });

  test("使えるロール未設定ならロールを問わない", () => {
    expect(decidePostability({ ...okFacts, authorRoleIds: [] }, [])).toEqual({ ok: true });
  });
});

describe("classifySendErrorCode", () => {
  test("DiscordのAPIエラーコードを失敗原因に分類する", () => {
    expect(classifySendErrorCode(10003)).toBe("channel_deleted");
    expect(classifySendErrorCode(50013)).toBe("bot_missing_permission");
    expect(classifySendErrorCode(50001)).toBe("bot_missing_permission");
    expect(classifySendErrorCode(50083)).toBe("thread_archived");
    expect(classifySendErrorCode(50035)).toBe("send_failed");
    expect(classifySendErrorCode(undefined)).toBe("send_failed");
  });
});

describe("メンション", () => {
  const all: MentionSelection = { everyone: true, here: true, roleIds: ["100", "200"], userIds: ["123"] };
  const policy = (patch: Partial<MentionPolicy> = {}): MentionPolicy => ({
    allowEveryone: true,
    allowHere: true,
    canMentionEveryone: true,
    isRoleMentionable: () => false,
    ...patch,
  });

  test("メンション行は@everyone @here ロール ユーザーの順で、allowedMentionsを明示指定する", () => {
    expect(buildMentionMessage(all, policy())).toEqual({
      content: "@everyone @here <@&100> <@&200> <@123>",
      allowedMentions: { parse: ["everyone"], roles: ["100", "200"], users: ["123"] },
    });
  });

  test("選択が空ならcontentなし・何も通知しない", () => {
    expect(buildMentionMessage({ everyone: false, here: false, roleIds: [], userIds: [] }, policy())).toEqual({
      content: undefined,
      allowedMentions: { parse: [], roles: [], users: [] },
    });
  });

  test("@hereのみ選択なら本文に@hereだけを含める", () => {
    const message = buildMentionMessage({ ...all, everyone: false, roleIds: [], userIds: [] }, policy());
    expect(message.content).toBe("@here");
    expect(message.allowedMentions.parse).toEqual(["everyone"]);
  });

  test("投稿時に許されないeveryone/here・メンション不可ロールは除外し、ユーザーは残す", () => {
    expect(buildMentionMessage(all, policy({ allowEveryone: false }))).toMatchObject({
      content: "@here <@&100> <@&200> <@123>",
    });
    expect(buildMentionMessage(all, policy({ allowEveryone: false, allowHere: false })).allowedMentions.parse).toEqual([]);
    expect(buildMentionMessage(all, policy({ canMentionEveryone: false, isRoleMentionable: (id) => id === "200" }))).toEqual({
      content: "<@&200> <@123>",
      allowedMentions: { parse: [], roles: ["200"], users: ["123"] },
    });
  });

  test("登録時の検証: 設定で不許可・権限なし・メンション不可ロールはエラー", () => {
    expect(validateMentionSelection(all, policy())).toBeNull();
    expect(validateMentionSelection(all, policy({ allowEveryone: false }))).toBe("everyone_not_allowed");
    expect(validateMentionSelection({ ...all, everyone: false }, policy({ allowHere: false }))).toBe("here_not_allowed");
    expect(validateMentionSelection({ ...all, roleIds: [] }, policy({ canMentionEveryone: false }))).toBe(
      "no_mention_everyone_permission",
    );
    expect(
      validateMentionSelection({ ...all, everyone: false, here: false }, policy({ canMentionEveryone: false })),
    ).toBe("role_not_mentionable");
    expect(
      validateMentionSelection(
        { ...all, everyone: false, here: false },
        policy({ canMentionEveryone: false, isRoleMentionable: () => true }),
      ),
    ).toBeNull();
  });
});

describe("DM本文", () => {
  const input = {
    channelId: "c1",
    scheduledAt: new Date("2026-10-10T11:00:00.000Z"),
    content: "本文```コード```",
    now: new Date("2026-10-10T11:00:05.000Z"),
  };

  test("失敗DMは投稿先・予定時刻・理由・本文を含み、コードブロックを壊さない", () => {
    const text = buildFailureDm({ ...input, reason: "author_left" });
    expect(text).toContain("<#c1>");
    expect(text).toContain("10月10日 20:00");
    expect(text).toContain("予約者がサーバーを退出していた");
    expect(text).toContain("本文'''コード'''");
  });

  test("管理者取り消しDM", () => {
    expect(buildAdminCancelDm(input)).toContain("管理者によって取り消されました");
  });
});
