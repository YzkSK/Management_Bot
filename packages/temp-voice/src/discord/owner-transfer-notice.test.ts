import { describe, expect, mock, test } from "bun:test";
import { ChannelType, type Client, type VoiceBasedChannel } from "discord.js";
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
  const panel = { author: { id: panelAuthorId }, components: [{ customId: "temp-voice:rename:vc-1" }], edit: mock(editImpl) };
  const controlChannel = {
    type: ChannelType.GuildText,
    send: mock(() => Promise.resolve()),
    messages: { fetch: mock(() => Promise.resolve({ first: () => panel })) },
  };
  const client = {
    user: { id: "bot-id" },
    channels: { cache: { get: (id: string) => (id === "ctrl-1" ? controlChannel : undefined) } },
  } as unknown as Client;
  return { client, controlChannel, panel };
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
    expect(controlChannel.messages.fetch).not.toHaveBeenCalled();
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
