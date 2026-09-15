import { describe, expect, mock, test } from "bun:test";
import type { Message } from "discord.js";
import type { EscalationOutcome } from "../application/index.js";
import { executeEscalationAction } from "./execute-action.js";

function outcome(overrides: Partial<EscalationOutcome> = {}): EscalationOutcome {
  return {
    violationType: "flood",
    strikeCount: 1,
    actionType: "messageDelete",
    caseId: "case-1",
    ...overrides,
  };
}

function fakeMessage(member: Record<string, unknown> | null = {}, author: Record<string, unknown> = {}) {
  return {
    delete: mock(() => Promise.resolve()),
    member,
    author: { send: mock(() => Promise.resolve()), ...author },
  };
}

describe("executeEscalationAction", () => {
  test("warnはDiscord APIを呼び出さないが、対象ユーザーにDMで警告を送る", async () => {
    const message = fakeMessage();
    await executeEscalationAction(message as unknown as Message, outcome({ actionType: "warn" }));
    expect(message.delete).not.toHaveBeenCalled();
    expect(message.author.send).toHaveBeenCalledTimes(1);
  });

  test("messageDelete等の処罰実行時にも対象ユーザーにDMで警告を送る", async () => {
    const message = fakeMessage();
    await executeEscalationAction(message as unknown as Message, outcome({ actionType: "messageDelete" }));
    expect(message.author.send).toHaveBeenCalledTimes(1);
  });

  test("DM送信が失敗(ブロック等)しても例外を投げず、処罰アクションは実行される", async () => {
    const message = fakeMessage({}, { send: mock(() => Promise.reject(new Error("Cannot send messages to this user"))) });
    await expect(
      executeEscalationAction(message as unknown as Message, outcome({ actionType: "messageDelete" })),
    ).resolves.toBeUndefined();
    expect(message.delete).toHaveBeenCalledTimes(1);
  });

  test("messageDeleteはmessage.delete()を呼ぶ", async () => {
    const message = fakeMessage();
    await executeEscalationAction(message as unknown as Message, outcome({ actionType: "messageDelete" }));
    expect(message.delete).toHaveBeenCalledTimes(1);
  });

  test("timeoutはmember.timeout()を呼ぶ", async () => {
    const timeout = mock(() => Promise.resolve());
    const message = fakeMessage({ timeout });
    await executeEscalationAction(message as unknown as Message, outcome({ actionType: "timeout" }));
    expect(timeout).toHaveBeenCalledTimes(1);
  });

  test("kickはmember.kick()を呼ぶ", async () => {
    const kick = mock(() => Promise.resolve());
    const message = fakeMessage({ kick });
    await executeEscalationAction(message as unknown as Message, outcome({ actionType: "kick" }));
    expect(kick).toHaveBeenCalledTimes(1);
  });

  test("banはmember.ban()を呼ぶ", async () => {
    const ban = mock(() => Promise.resolve());
    const message = fakeMessage({ ban });
    await executeEscalationAction(message as unknown as Message, outcome({ actionType: "ban" }));
    expect(ban).toHaveBeenCalledTimes(1);
  });

  test("memberがnull(既に退出済み等)でも例外を投げない", async () => {
    const message = fakeMessage(null);
    await expect(
      executeEscalationAction(message as unknown as Message, outcome({ actionType: "timeout" })),
    ).resolves.toBeUndefined();
  });

  test("Discord API呼び出しが失敗しても例外を投げない", async () => {
    const message = { delete: mock(() => Promise.reject(new Error("missing permissions"))), member: {} };
    await expect(
      executeEscalationAction(message as unknown as Message, outcome({ actionType: "messageDelete" })),
    ).resolves.toBeUndefined();
  });
});
