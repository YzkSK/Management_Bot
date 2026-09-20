import { describe, expect, mock, test } from "bun:test";
import { ContainerBuilder, MessageFlags } from "discord.js";
import type { Message } from "discord.js";
import type { EscalationOutcome } from "../application/index.js";
import { executeEscalationAction } from "./execute-action.js";

function outcome(overrides: Partial<EscalationOutcome> = {}): EscalationOutcome {
  return {
    violationType: "flood",
    strikeCount: 1,
    actionType: "warn",
    caseId: "case-1",
    bufferedMessageIds: ["m2", "m1"],
    ...overrides,
  };
}

function fakeMessage(member: Record<string, unknown> | null = {}, author: Record<string, unknown> = {}) {
  return {
    delete: mock(() => Promise.resolve()),
    channel: { bulkDelete: mock(() => Promise.resolve()) },
    member,
    author: { send: mock(() => Promise.resolve()), ...author },
  };
}

describe("executeEscalationAction", () => {
  test("warnはbufferedMessageIdsを削除したうえで対象ユーザーにDMで警告を送る(削除が先)", async () => {
    const calls: string[] = [];
    const message = {
      author: { send: mock(async () => void calls.push("dm")) },
      channel: { bulkDelete: mock(async () => void calls.push("delete")) },
      member: {},
    };
    await executeEscalationAction(
      message as unknown as Message,
      outcome({ actionType: "warn", bufferedMessageIds: ["m3", "m2", "m1"] }),
    );
    expect(message.channel.bulkDelete).toHaveBeenCalledWith(["m3", "m2", "m1"]);
    expect(calls).toEqual(["delete", "dm"]);
  });

  test("warn実行時にメッセージ削除が失敗しても、警告DM送信は実行される(削除失敗が警告をブロックしない)", async () => {
    const message = fakeMessage();
    message.channel.bulkDelete = mock(() => Promise.reject(new Error("missing permissions")));
    await executeEscalationAction(message as unknown as Message, outcome({ actionType: "warn" }));
    expect(message.author.send).toHaveBeenCalledTimes(1);
  });

  test("警告DMはComponents V2のContainerカードとして送る", async () => {
    const message = fakeMessage();
    await executeEscalationAction(message as unknown as Message, outcome({ actionType: "warn" }));
    const payload = (message.author.send as ReturnType<typeof mock>).mock.calls[0][0];
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.components).toHaveLength(1);
    expect(payload.components[0]).toBeInstanceOf(ContainerBuilder);
  });

  test("timeout実行後のDM文言はtimeoutMinutesに応じて動的に変わる(#322)", async () => {
    const timeout = mock(() => Promise.resolve());
    const message = fakeMessage({ timeout });
    await executeEscalationAction(message as unknown as Message, outcome({ actionType: "timeout", timeoutMinutes: 30 }));
    const payload = (message.author.send as ReturnType<typeof mock>).mock.calls[0][0];
    const container = (payload.components[0] as ContainerBuilder).toJSON();
    const text = container.components.map((c) => ("content" in c ? c.content : "")).join("\n");
    expect(text).toContain("30分間のタイムアウト");
  });

  test("DM送信が失敗(ブロック等)しても例外を投げない", async () => {
    const message = fakeMessage({}, { send: mock(() => Promise.reject(new Error("Cannot send messages to this user"))) });
    await expect(
      executeEscalationAction(message as unknown as Message, outcome({ actionType: "warn" })),
    ).resolves.toEqual({ result: "success" });
    expect(message.channel.bulkDelete).toHaveBeenCalledTimes(1);
  });

  test("warnはbufferedMessageIds全件をchannel.bulkDelete()に渡す", async () => {
    const message = fakeMessage();
    await executeEscalationAction(
      message as unknown as Message,
      outcome({ actionType: "warn", bufferedMessageIds: ["m3", "m2", "m1"] }),
    );
    expect(message.channel.bulkDelete).toHaveBeenCalledTimes(1);
    expect(message.channel.bulkDelete).toHaveBeenCalledWith(["m3", "m2", "m1"]);
  });

  test("channelがbulkDeleteを持たない(DM等)場合、warnの削除はmessage.delete()にフォールバックする", async () => {
    const message = { ...fakeMessage(), channel: {} };
    await executeEscalationAction(message as unknown as Message, outcome({ actionType: "warn" }));
    expect(message.delete).toHaveBeenCalledTimes(1);
  });

  test("bufferedMessageIdsが1件のみ(Discordのbulk deleteは2件以上必須)の場合、message.delete()にフォールバックする", async () => {
    const message = fakeMessage();
    await executeEscalationAction(
      message as unknown as Message,
      outcome({ actionType: "warn", bufferedMessageIds: ["m1"] }),
    );
    expect(message.delete).toHaveBeenCalledTimes(1);
    expect(message.channel.bulkDelete).not.toHaveBeenCalled();
  });

  test("timeoutはmember.timeout()を呼ぶとともにbufferedMessageIdsを削除する(連投が続いてもメッセージ削除が漏れないようにするため)", async () => {
    const timeout = mock(() => Promise.resolve());
    const message = fakeMessage({ timeout });
    await executeEscalationAction(message as unknown as Message, outcome({ actionType: "timeout", timeoutMinutes: 5 }));
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(message.channel.bulkDelete).toHaveBeenCalledTimes(1);
  });

  test.each([
    [5, 5 * 60 * 1000],
    [10, 10 * 60 * 1000],
    [30, 30 * 60 * 1000],
  ])("timeoutMinutes=%d分の場合、member.timeout()に%dミリ秒を渡す(#322、多段階化)", async (minutes, expectedMs) => {
    const timeout = mock(() => Promise.resolve());
    const message = fakeMessage({ timeout });
    await executeEscalationAction(message as unknown as Message, outcome({ actionType: "timeout", timeoutMinutes: minutes }));
    expect(timeout).toHaveBeenCalledWith(expectedMs, expect.any(String));
  });

  test("timeoutMinutesが未設定(本来起こりえない状態)の場合、実処理とDM文言の両方が10分にフォールバックする(Codexレビュー指摘: 不整合防止)", async () => {
    const timeout = mock(() => Promise.resolve());
    const message = fakeMessage({ timeout });
    await executeEscalationAction(message as unknown as Message, outcome({ actionType: "timeout", timeoutMinutes: undefined }));
    expect(timeout).toHaveBeenCalledWith(10 * 60 * 1000, expect.any(String));
    const payload = (message.author.send as ReturnType<typeof mock>).mock.calls[0][0];
    const container = (payload.components[0] as ContainerBuilder).toJSON();
    const text = container.components.map((c) => ("content" in c ? c.content : "")).join("\n");
    expect(text).toContain("10分間のタイムアウト");
  });

  test("kickはmember.kick()を呼ぶとともにbufferedMessageIdsを削除する", async () => {
    const kick = mock(() => Promise.resolve());
    const message = fakeMessage({ kick });
    await executeEscalationAction(message as unknown as Message, outcome({ actionType: "kick" }));
    expect(kick).toHaveBeenCalledTimes(1);
    expect(message.channel.bulkDelete).toHaveBeenCalledTimes(1);
  });

  test("banはmember.ban()を呼ぶとともにbufferedMessageIdsを削除する", async () => {
    const ban = mock(() => Promise.resolve());
    const message = fakeMessage({ ban });
    await executeEscalationAction(message as unknown as Message, outcome({ actionType: "ban" }));
    expect(ban).toHaveBeenCalledTimes(1);
    expect(message.channel.bulkDelete).toHaveBeenCalledTimes(1);
  });

  test("timeout実行時にメッセージ削除が失敗しても、timeout自体とDM送信は実行される(削除失敗が処罰をブロックしない)", async () => {
    const timeout = mock(() => Promise.resolve());
    const message = fakeMessage({ timeout });
    message.channel.bulkDelete = mock(() => Promise.reject(new Error("missing permissions")));
    await executeEscalationAction(message as unknown as Message, outcome({ actionType: "timeout" }));
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(message.author.send).toHaveBeenCalledTimes(1);
  });

  test("memberがnull(既に退出済み・Webhook投稿等、改善案7.2節)の場合、処罰・DM送信は行わないがメッセージ削除は実行する", async () => {
    const message = fakeMessage(null);
    await expect(
      executeEscalationAction(message as unknown as Message, outcome({ actionType: "timeout" })),
    ).resolves.toEqual({ result: "failed", failureCode: "member_not_found" });
    expect(message.author.send).not.toHaveBeenCalled();
    // 削除は独立したアクション種別ではなく全段階共通の付随処理のため、member不在でも実行される(#377)。
    expect(message.channel.bulkDelete).toHaveBeenCalledTimes(1);
  });

  test("memberがnull(Webhook投稿等)のwarnは削除とDM送信試行を行い成功扱いになる(#377、DM失敗は握りつぶす既存設計)", async () => {
    const message = fakeMessage(null, { send: mock(() => Promise.reject(new Error("Cannot send messages to this user"))) });
    await expect(
      executeEscalationAction(message as unknown as Message, outcome({ actionType: "warn" })),
    ).resolves.toEqual({ result: "success" });
    expect(message.channel.bulkDelete).toHaveBeenCalledTimes(1);
    expect(message.author.send).toHaveBeenCalledTimes(1);
  });

  test("kick/banもmemberがnullの場合、処罰は行わないがメッセージ削除は実行する(#377)", async () => {
    const kickMessage = fakeMessage(null);
    await expect(
      executeEscalationAction(kickMessage as unknown as Message, outcome({ actionType: "kick" })),
    ).resolves.toEqual({ result: "failed", failureCode: "member_not_found" });
    expect(kickMessage.channel.bulkDelete).toHaveBeenCalledTimes(1);

    const banMessage = fakeMessage(null);
    await expect(
      executeEscalationAction(banMessage as unknown as Message, outcome({ actionType: "ban" })),
    ).resolves.toEqual({ result: "failed", failureCode: "member_not_found" });
    expect(banMessage.channel.bulkDelete).toHaveBeenCalledTimes(1);
  });

  test("Discord API呼び出し(member.kick())が失敗した場合、例外を投げず警告DMも送らない", async () => {
    const kick = mock(() => Promise.reject(new Error("missing permissions")));
    const message = fakeMessage({ kick });
    await expect(
      executeEscalationAction(message as unknown as Message, outcome({ actionType: "kick" })),
    ).resolves.toEqual({ result: "failed", failureCode: "discord_api_error" });
    expect(message.author.send).not.toHaveBeenCalled();
  });

  test("unbanは処罰APIもDM送信も行わない", async () => {
    const message = fakeMessage();
    await executeEscalationAction(message as unknown as Message, outcome({ actionType: "unban" }));
    expect(message.author.send).not.toHaveBeenCalled();
  });
});
