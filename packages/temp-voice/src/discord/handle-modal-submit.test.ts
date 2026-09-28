import { describe, expect, mock, test } from "bun:test";
import type { ModalSubmitInteraction } from "discord.js";
import { handleTempVoiceModalSubmit, type HandleModalSubmitDeps } from "./handle-modal-submit.js";

const OWNED_ROW = { channelId: "vc-1", guildId: "g1", controlChannelId: "ctrl-1", ownerId: "owner-1" };

function fakeDb(row: typeof OWNED_ROW | null) {
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve(row ? [row] : []) }) }),
  };
}

function fakeVoiceChannel(overrides: Partial<Record<string, unknown>> = {}) {
  const channel: Record<string, unknown> = {
    id: "vc-1",
    name: "太郎のVC",
    userLimit: 5,
    bitrate: 96000,
    guild: { roles: { everyone: { id: "everyone-id" } } },
    permissionOverwrites: { cache: { get: () => undefined } },
    isVoiceBased: () => true,
    // setName/setUserLimit/setBitrateはdiscord.js実装ではPromise<this>(更新後の自チャンネル)を返す。
    setName: mock(() => Promise.resolve(channel)),
    setUserLimit: mock(() => Promise.resolve(channel)),
    setBitrate: mock(() => Promise.resolve(channel)),
    ...overrides,
  };
  return channel;
}

function fakeControlChannel() {
  return { id: "ctrl-1", isTextBased: () => true, setName: mock(() => Promise.resolve()) };
}

function fakeInteraction(
  customId: string,
  userId: string,
  voiceChannel: unknown,
  inputValue: string,
  controlChannel: unknown = fakeControlChannel(),
) {
  const message = { edit: mock(() => Promise.resolve()) };
  return {
    customId,
    user: { id: userId, displayName: "user" },
    guild: {
      channels: { cache: { get: (id: string) => (id === "ctrl-1" ? controlChannel : voiceChannel) } },
      maximumBitrate: 128_000,
    },
    fields: { getTextInputValue: () => inputValue },
    reply: mock(() => Promise.resolve()),
    deferUpdate: mock(() => Promise.resolve()),
    followUp: mock(() => Promise.resolve()),
    message,
  } as unknown as ModalSubmitInteraction;
}

const ALWAYS_RESERVE = () => true;

describe("handleTempVoiceModalSubmit", () => {
  test("オーナー以外の送信は拒否メッセージを返す", async () => {
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() }, tryReserveRenameSlot: ALWAYS_RESERVE } as unknown as HandleModalSubmitDeps;
    const interaction = fakeInteraction("temp-voice:rename:vc-1", "someone-else", fakeVoiceChannel(), "新しい名前");

    await handleTempVoiceModalSubmit(deps, interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("オーナー") }));
  });

  test("rename: 空文字はバリデーションエラーを返しAPIを呼ばない", async () => {
    const voiceChannel = fakeVoiceChannel();
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() }, tryReserveRenameSlot: ALWAYS_RESERVE } as unknown as HandleModalSubmitDeps;
    const interaction = fakeInteraction("temp-voice:rename:vc-1", "owner-1", voiceChannel, "   ");

    await handleTempVoiceModalSubmit(deps, interaction);

    expect(voiceChannel.setName).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.any(String) }));
  });

  test("rename: tryReserveRenameSlotがfalseを返せばレート制限メッセージを返しAPIを呼ばない", async () => {
    const voiceChannel = fakeVoiceChannel();
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() }, tryReserveRenameSlot: () => false } as unknown as HandleModalSubmitDeps;
    const interaction = fakeInteraction("temp-voice:rename:vc-1", "owner-1", voiceChannel, "新しい名前");

    await handleTempVoiceModalSubmit(deps, interaction);

    expect(voiceChannel.setName).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("しばらく") }));
  });

  test("rename: 正常入力でVC・制御チャンネル両方をsetNameし、deferUpdate+イベント発行する", async () => {
    const voiceChannel = fakeVoiceChannel();
    const controlChannel = fakeControlChannel();
    const publish = mock(() => Promise.resolve());
    const tryReserveRenameSlot = mock(() => true);
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish }, tryReserveRenameSlot } as unknown as HandleModalSubmitDeps;
    const interaction = fakeInteraction("temp-voice:rename:vc-1", "owner-1", voiceChannel, "新しい名前", controlChannel);

    await handleTempVoiceModalSubmit(deps, interaction);

    expect(voiceChannel.setName).toHaveBeenCalledWith("新しい名前", expect.any(String));
    expect(controlChannel.setName).toHaveBeenCalledWith("新しい名前", expect.any(String));
    expect(tryReserveRenameSlot).toHaveBeenCalledWith("vc-1");
    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ action: "renamed", before: "太郎のVC", after: "新しい名前" }));
  });

  test("rename: 制御チャンネル側のsetName失敗はVC側の成功を妨げないが、ephemeralで案内する", async () => {
    const voiceChannel = fakeVoiceChannel();
    const controlChannel = { id: "ctrl-1", isTextBased: () => true, setName: mock(() => Promise.reject(new Error("rate limited"))) };
    const publish = mock(() => Promise.resolve());
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish }, tryReserveRenameSlot: ALWAYS_RESERVE } as unknown as HandleModalSubmitDeps;
    const interaction = fakeInteraction("temp-voice:rename:vc-1", "owner-1", voiceChannel, "新しい名前", controlChannel);

    await handleTempVoiceModalSubmit(deps, interaction);

    expect(voiceChannel.setName).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ action: "renamed" }));
    expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("制御チャンネル") }));
  });

  test("rename: setName自体が失敗したらephemeralフォローアップを送り例外をthrowする", async () => {
    const voiceChannel = fakeVoiceChannel({ setName: mock(() => Promise.reject(new Error("missing permissions"))) });
    const publish = mock(() => Promise.resolve());
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish }, tryReserveRenameSlot: ALWAYS_RESERVE } as unknown as HandleModalSubmitDeps;
    const interaction = fakeInteraction("temp-voice:rename:vc-1", "owner-1", voiceChannel, "新しい名前");

    await expect(handleTempVoiceModalSubmit(deps, interaction)).rejects.toThrow();

    expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.any(String) }));
    expect(publish).not.toHaveBeenCalled();
  });

  test("userLimit: 範囲外はバリデーションエラーを返す", async () => {
    const voiceChannel = fakeVoiceChannel();
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() }, tryReserveRenameSlot: ALWAYS_RESERVE } as unknown as HandleModalSubmitDeps;
    const interaction = fakeInteraction("temp-voice:userLimit:vc-1", "owner-1", voiceChannel, "100");

    await handleTempVoiceModalSubmit(deps, interaction);

    expect(voiceChannel.setUserLimit).not.toHaveBeenCalled();
  });

  test("userLimit: 空白のみの入力はバリデーションエラーを返す", async () => {
    const voiceChannel = fakeVoiceChannel();
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() }, tryReserveRenameSlot: ALWAYS_RESERVE } as unknown as HandleModalSubmitDeps;
    const interaction = fakeInteraction("temp-voice:userLimit:vc-1", "owner-1", voiceChannel, "   ");

    await handleTempVoiceModalSubmit(deps, interaction);

    expect(voiceChannel.setUserLimit).not.toHaveBeenCalled();
  });

  test("userLimit: 正常入力でsetUserLimitしイベント発行する", async () => {
    const voiceChannel = fakeVoiceChannel();
    const publish = mock(() => Promise.resolve());
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish }, tryReserveRenameSlot: ALWAYS_RESERVE } as unknown as HandleModalSubmitDeps;
    const interaction = fakeInteraction("temp-voice:userLimit:vc-1", "owner-1", voiceChannel, "10");

    await handleTempVoiceModalSubmit(deps, interaction);

    expect(voiceChannel.setUserLimit).toHaveBeenCalledWith(10, expect.any(String));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ action: "userLimitChanged", before: 5, after: 10 }));
  });

  test("bitrate: guildの上限を超える入力はエラーを返す", async () => {
    const voiceChannel = fakeVoiceChannel();
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() }, tryReserveRenameSlot: ALWAYS_RESERVE } as unknown as HandleModalSubmitDeps;
    const interaction = fakeInteraction("temp-voice:bitrate:vc-1", "owner-1", voiceChannel, "256");

    await handleTempVoiceModalSubmit(deps, interaction);

    expect(voiceChannel.setBitrate).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("128") }));
  });

  test("bitrate: 8kbps未満はエラーを返す", async () => {
    const voiceChannel = fakeVoiceChannel();
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() }, tryReserveRenameSlot: ALWAYS_RESERVE } as unknown as HandleModalSubmitDeps;
    const interaction = fakeInteraction("temp-voice:bitrate:vc-1", "owner-1", voiceChannel, "1");

    await handleTempVoiceModalSubmit(deps, interaction);

    expect(voiceChannel.setBitrate).not.toHaveBeenCalled();
  });

  test("bitrate: 上限内の入力でsetBitrateしイベント発行する", async () => {
    const voiceChannel = fakeVoiceChannel();
    const publish = mock(() => Promise.resolve());
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish }, tryReserveRenameSlot: ALWAYS_RESERVE } as unknown as HandleModalSubmitDeps;
    const interaction = fakeInteraction("temp-voice:bitrate:vc-1", "owner-1", voiceChannel, "96");

    await handleTempVoiceModalSubmit(deps, interaction);

    expect(voiceChannel.setBitrate).toHaveBeenCalledWith(96_000, expect.any(String));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ action: "bitrateChanged", before: 96000, after: 96000 }));
  });

  test("bitrate: setBitrateが失敗したらephemeralフォローアップを送り例外をthrowする", async () => {
    const voiceChannel = fakeVoiceChannel({ setBitrate: mock(() => Promise.reject(new Error("missing permissions"))) });
    const publish = mock(() => Promise.resolve());
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish }, tryReserveRenameSlot: ALWAYS_RESERVE } as unknown as HandleModalSubmitDeps;
    const interaction = fakeInteraction("temp-voice:bitrate:vc-1", "owner-1", voiceChannel, "96");

    await expect(handleTempVoiceModalSubmit(deps, interaction)).rejects.toThrow();

    expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.any(String) }));
    expect(publish).not.toHaveBeenCalled();
  });
});
