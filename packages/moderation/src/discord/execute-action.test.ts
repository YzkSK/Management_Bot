import { describe, expect, mock, test } from "bun:test";
import { ContainerBuilder, MessageFlags } from "discord.js";
import type { Message } from "discord.js";
import type { EscalationOutcome } from "../application/index.js";
import { executeEscalationAction } from "./execute-action.js";

function outcome(overrides: Partial<EscalationOutcome> = {}): EscalationOutcome {
  return {
    violationType: "flood",
    strikeCount: 1,
    actionType: "messageDelete",
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
  test("warnは対象ユーザーにDMで警告を送るのみで、他のDiscord APIは呼び出さない", async () => {
    const message = fakeMessage();
    await executeEscalationAction(message as unknown as Message, outcome({ actionType: "warn" }));
    expect(message.channel.bulkDelete).not.toHaveBeenCalled();
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

  test("messageDelete成功後に対象ユーザーへDMで警告を送る(処罰が先)", async () => {
    const calls: string[] = [];
    const message = {
      author: { send: mock(async () => void calls.push("dm")) },
      channel: { bulkDelete: mock(async () => void calls.push("delete")) },
      member: {},
    };
    await executeEscalationAction(message as unknown as Message, outcome({ actionType: "messageDelete" }));
    expect(calls).toEqual(["delete", "dm"]);
  });

  test("DM送信が失敗(ブロック等)しても例外を投げない", async () => {
    const message = fakeMessage({}, { send: mock(() => Promise.reject(new Error("Cannot send messages to this user"))) });
    await expect(
      executeEscalationAction(message as unknown as Message, outcome({ actionType: "messageDelete" })),
    ).resolves.toBeUndefined();
    expect(message.channel.bulkDelete).toHaveBeenCalledTimes(1);
  });

  test("messageDeleteはbufferedMessageIds全件をchannel.bulkDelete()に渡す", async () => {
    const message = fakeMessage();
    await executeEscalationAction(
      message as unknown as Message,
      outcome({ actionType: "messageDelete", bufferedMessageIds: ["m3", "m2", "m1"] }),
    );
    expect(message.channel.bulkDelete).toHaveBeenCalledTimes(1);
    expect(message.channel.bulkDelete).toHaveBeenCalledWith(["m3", "m2", "m1"]);
  });

  test("channelがbulkDeleteを持たない(DM等)場合、messageDeleteはmessage.delete()にフォールバックする", async () => {
    const message = { ...fakeMessage(), channel: {} };
    await executeEscalationAction(message as unknown as Message, outcome({ actionType: "messageDelete" }));
    expect(message.delete).toHaveBeenCalledTimes(1);
  });

  test("bufferedMessageIdsが1件のみ(Discordのbulk deleteは2件以上必須)の場合、message.delete()にフォールバックする", async () => {
    const message = fakeMessage();
    await executeEscalationAction(
      message as unknown as Message,
      outcome({ actionType: "messageDelete", bufferedMessageIds: ["m1"] }),
    );
    expect(message.delete).toHaveBeenCalledTimes(1);
    expect(message.channel.bulkDelete).not.toHaveBeenCalled();
  });

  test("timeoutはmember.timeout()を呼ぶとともにbufferedMessageIdsを削除する(連投が続いてもメッセージ削除が漏れないようにするため)", async () => {
    const timeout = mock(() => Promise.resolve());
    const message = fakeMessage({ timeout });
    await executeEscalationAction(message as unknown as Message, outcome({ actionType: "timeout" }));
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(message.channel.bulkDelete).toHaveBeenCalledTimes(1);
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

  test("memberがnull(既に退出済み等)の場合、処罰もメッセージ削除もDM送信も行わない", async () => {
    const message = fakeMessage(null);
    await expect(
      executeEscalationAction(message as unknown as Message, outcome({ actionType: "timeout" })),
    ).resolves.toBeUndefined();
    expect(message.author.send).not.toHaveBeenCalled();
    expect(message.channel.bulkDelete).not.toHaveBeenCalled();
  });

  test("Discord API呼び出しが失敗した場合、例外を投げず警告DMも送らない", async () => {
    const message = fakeMessage({}, {});
    message.channel.bulkDelete = mock(() => Promise.reject(new Error("missing permissions")));
    await expect(
      executeEscalationAction(message as unknown as Message, outcome({ actionType: "messageDelete" })),
    ).resolves.toBeUndefined();
    expect(message.author.send).not.toHaveBeenCalled();
  });

  test("unbanは処罰APIもDM送信も行わない", async () => {
    const message = fakeMessage();
    await executeEscalationAction(message as unknown as Message, outcome({ actionType: "unban" }));
    expect(message.author.send).not.toHaveBeenCalled();
  });
});
