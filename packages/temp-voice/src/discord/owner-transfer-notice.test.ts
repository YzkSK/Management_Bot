import { describe, expect, mock, test } from "bun:test";
import { ChannelType, Collection, type Client, type VoiceBasedChannel } from "discord.js";
import { announceOwnerTransfer, buildOwnerTransferNotice } from "./owner-transfer-notice.js";

function fakeVoiceChannel() {
  return {
    id: "vc-1",
    userLimit: 0,
    bitrate: 64000,
    guild: { roles: { everyone: { id: "everyone-id" } } },
    permissionOverwrites: { cache: { get: () => undefined } },
  } as unknown as VoiceBasedChannel;
}

function fakeSetup(panelAuthorId = "bot-id", editImpl = () => Promise.resolve()) {
  const panel = { id: "panel", author: { id: panelAuthorId }, components: [{ customId: "temp-voice:rename:vc-1", label: "オーナー移譲" }], edit: mock(editImpl), delete: mock(() => Promise.resolve()) };
  const oldNotice = { id: "old-notice", author: { id: "bot-id" }, components: [{ content: "## 👑 オーナー移譲" }], delete: mock(() => Promise.resolve()) };
  const otherNotice = { id: "other", author: { id: "someone" }, components: [{ content: "## 👑 オーナー移譲" }], delete: mock(() => Promise.resolve()) };
  const controlChannel = {
    type: ChannelType.GuildText,
    send: mock(() => Promise.resolve({ id: "new-notice" })),
    messages: {
      fetch: mock((options: { after?: string }) =>
        Promise.resolve(new Collection(options.after ? [["panel", panel]] : [["notice", oldNotice], ["other", otherNotice], ["panel", panel]])),
      ),
    },
  };
  const client = {
    user: { id: "bot-id" },
    channels: { cache: { get: (id: string) => (id === "ctrl-1" ? controlChannel : undefined) } },
  } as unknown as Client;
  return { client, controlChannel, panel, oldNotice, otherNotice };
}

describe("buildOwnerTransferNotice", () => {
  test("新オーナーへのメンションを含み、メンション通知は新オーナーのみに絞る", () => {
    const notice = buildOwnerTransferNotice("old-owner", "new-owner", "manual");
    const text = JSON.stringify(notice.components);
    expect(text).toContain("<@new-owner>");
    expect(text).toContain("<@old-owner>");
    expect(notice.allowedMentions).toEqual({ users: ["new-owner"] });
  });

  test("自動移譲は理由の文言が変わる", () => {
    expect(JSON.stringify(buildOwnerTransferNotice("old-owner", "new-owner", "autoGraceExpired").components)).toContain("自動");
  });
});

describe("announceOwnerTransfer", () => {
  test("voiceChannel無し(手動移譲)は通知のみ送りパネルを探さない", async () => {
    const { client, controlChannel } = fakeSetup();
    await announceOwnerTransfer(client, "ctrl-1", "old-owner", "new-owner", "manual");
    expect(controlChannel.send).toHaveBeenCalledTimes(1);
    expect(controlChannel.messages.fetch).not.toHaveBeenCalledWith({ after: "0", limit: 1 });
  });

  test("前回のbotの移譲通知だけを削除し、パネルや他者のメッセージは消さない", async () => {
    const { client, controlChannel, panel, oldNotice, otherNotice } = fakeSetup();
    await announceOwnerTransfer(client, "ctrl-1", "old-owner", "new-owner", "manual");
    expect(oldNotice.delete).toHaveBeenCalledTimes(1);
    expect(panel.delete).not.toHaveBeenCalled();
    expect(otherNotice.delete).not.toHaveBeenCalled();
    expect(controlChannel.send).toHaveBeenCalledTimes(1);
  });

  test("1件の削除に失敗しても残りの旧通知の削除を続ける", async () => {
    const { client, controlChannel, oldNotice } = fakeSetup();
    oldNotice.delete = mock(() => Promise.reject(new Error("boom")));
    const another = { id: "old-2", author: { id: "bot-id" }, components: [{ content: "## 👑 オーナー移譲" }], delete: mock(() => Promise.resolve()) };
    controlChannel.messages.fetch = mock(() => Promise.resolve(new Collection([["a", oldNotice], ["b", another]])));
    await announceOwnerTransfer(client, "ctrl-1", "old-owner", "new-owner", "manual");
    expect(another.delete).toHaveBeenCalledTimes(1);
  });

  test("新通知の送信に失敗したら旧通知を削除しない", async () => {
    const { client, controlChannel, oldNotice } = fakeSetup();
    controlChannel.send = mock(() => Promise.reject(new Error("boom")));
    await announceOwnerTransfer(client, "ctrl-1", "old-owner", "new-owner", "manual");
    expect(oldNotice.delete).not.toHaveBeenCalled();
  });

  test("voiceChannel有り(自動移譲)は最古のbotメッセージ=パネルを新オーナー表示でeditしてから通知する", async () => {
    const { client, controlChannel, panel } = fakeSetup();
    await announceOwnerTransfer(client, "ctrl-1", "old-owner", "new-owner", "autoGraceExpired", fakeVoiceChannel());
    expect(controlChannel.messages.fetch).toHaveBeenCalledWith({ after: "0", limit: 1 });
    expect(JSON.stringify(panel.edit.mock.calls[0])).toContain("オーナー: <@new-owner>");
    expect(controlChannel.send).toHaveBeenCalledTimes(1);
  });

  test("最古メッセージがbot以外ならeditしない", async () => {
    const { client, panel } = fakeSetup("someone");
    await announceOwnerTransfer(client, "ctrl-1", "old-owner", "new-owner", "autoGraceExpired", fakeVoiceChannel());
    expect(panel.edit).not.toHaveBeenCalled();
  });

  test("最古メッセージがパネルでない(制御パネルのcustomIdを含まない)ならeditしない", async () => {
    const { client, panel } = fakeSetup();
    panel.components = [];
    await announceOwnerTransfer(client, "ctrl-1", "old-owner", "new-owner", "autoGraceExpired", fakeVoiceChannel());
    expect(panel.edit).not.toHaveBeenCalled();
  });

  test("パネルeditはメンション通知を飛ばさない", async () => {
    const { client, panel } = fakeSetup();
    await announceOwnerTransfer(client, "ctrl-1", "old-owner", "new-owner", "autoGraceExpired", fakeVoiceChannel());
    expect(panel.edit).toHaveBeenCalledWith(expect.objectContaining({ allowedMentions: { parse: [] } }));
  });

  test("パネル更新に失敗しても通知は送る", async () => {
    const { client, controlChannel } = fakeSetup("bot-id", () => Promise.reject(new Error("boom")));
    await announceOwnerTransfer(client, "ctrl-1", "old-owner", "new-owner", "autoGraceExpired", fakeVoiceChannel());
    expect(controlChannel.send).toHaveBeenCalledTimes(1);
  });
});
