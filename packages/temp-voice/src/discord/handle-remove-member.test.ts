import { describe, expect, mock, test } from "bun:test";
import type { ButtonInteraction } from "discord.js";
import { handleTempVoiceRemoveMember, type HandleRemoveMemberDeps } from "./handle-remove-member.js";

const OWNED_ROW = { channelId: "vc-1", guildId: "g1", controlChannelId: "ctrl-1", ownerId: "owner-1" };

function fakeDb(row: typeof OWNED_ROW | null) {
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve(row ? [row] : []) }) }),
    delete: () => ({ where: () => Promise.resolve() }),
  };
}

function fakeVoiceChannel(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "vc-1",
    permissionOverwrites: { edit: mock(() => Promise.resolve()) },
    isVoiceBased: () => true,
    ...overrides,
  };
}

function fakeInteraction(customId: string, userId: string, voiceChannel: unknown) {
  return {
    customId,
    user: { id: userId, displayName: "user" },
    guild: { channels: { cache: { get: () => voiceChannel } }, members: { cache: { get: () => undefined } }, roles: { cache: { get: () => undefined } } },
    reply: mock(() => Promise.resolve()),
    deferUpdate: mock(() => Promise.resolve()),
    editReply: mock(() => Promise.resolve()),
    followUp: mock(() => Promise.resolve()),
  } as unknown as ButtonInteraction;
}

describe("handleTempVoiceRemoveMember", () => {
  test("removeMember以外のcustomIdは無視する", async () => {
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() } } as unknown as HandleRemoveMemberDeps;
    const interaction = fakeInteraction("temp-voice:rename:vc-1", "owner-1", fakeVoiceChannel());

    await handleTempVoiceRemoveMember(deps, interaction);

    expect(interaction.reply).not.toHaveBeenCalled();
  });

  test("オーナー以外は拒否メッセージを返す", async () => {
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() } } as unknown as HandleRemoveMemberDeps;
    const interaction = fakeInteraction("temp-voice:removeMember:vc-1:user:user-1", "someone-else", fakeVoiceChannel());

    await handleTempVoiceRemoveMember(deps, interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("オーナー") }));
  });

  test("正常系: Connectキーをクリアするeditを呼びComponents V2で解除完了を返す", async () => {
    const publish = mock(() => Promise.resolve());
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish } } as unknown as HandleRemoveMemberDeps;
    const voiceChannel = fakeVoiceChannel();
    const interaction = fakeInteraction("temp-voice:removeMember:vc-1:user:user-1", "owner-1", voiceChannel);

    await handleTempVoiceRemoveMember(deps, interaction);

    expect(voiceChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      "user-1",
      { Connect: null },
      expect.objectContaining({ reason: expect.any(String) }),
    );
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    const replyArg = (interaction.editReply as ReturnType<typeof mock>).mock.calls[0]?.[0];
    expect(replyArg.content).toBeUndefined();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ action: "memberPermissionChanged", state: "cleared", targetType: "user", targetId: "user-1" }),
    );
  });

  test("overwrite編集失敗時はephemeralフォローアップを送り例外をthrowする", async () => {
    const voiceChannel = fakeVoiceChannel({ permissionOverwrites: { edit: mock(() => Promise.reject(new Error("missing permissions"))) } });
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() } } as unknown as HandleRemoveMemberDeps;
    const interaction = fakeInteraction("temp-voice:removeMember:vc-1:role:role-1", "owner-1", voiceChannel);

    await expect(handleTempVoiceRemoveMember(deps, interaction)).rejects.toThrow();

    expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.any(String) }));
  });
});
