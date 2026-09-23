import { describe, expect, mock, test } from "bun:test";
import { PermissionFlagsBits } from "discord.js";
import type { ButtonInteraction } from "discord.js";
import { handleTempVoiceButton, type HandleButtonDeps } from "./handle-button.js";

const OWNED_ROW = { channelId: "vc-1", guildId: "g1", controlChannelId: "ctrl-1", ownerId: "owner-1" };

function fakeDb(row: typeof OWNED_ROW | null, overrides: unknown[] = []) {
  let selectCallCount = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => {
          selectCallCount += 1;
          // 1回目=findTempVoiceChannel、2回目以降=listPermissionOverrides(manageMembers時のみ)。
          return Promise.resolve(selectCallCount === 1 ? (row ? [row] : []) : overrides);
        },
      }),
    }),
  };
}

function fakeVoiceChannel(overrides: Partial<Record<string, unknown>> = {}) {
  const overwriteStore = new Map<string, { deny: { has: (bit: bigint) => boolean } }>();
  const channel: Record<string, unknown> = {
    id: "vc-1",
    name: "太郎のVC",
    userLimit: 5,
    bitrate: 96000,
    guild: { roles: { everyone: { id: "everyone-id" } } },
    permissionOverwrites: {
      cache: { get: (id: string) => overwriteStore.get(id) },
      // editの戻り値は更新後のチャンネル(discord.jsの実挙動)。呼び出し元がこれを使ってパネルを再描画する。
      edit: mock((_id: string, changes: Record<string, unknown>) => {
        overwriteStore.set("everyone-id", {
          deny: {
            has: (bit: bigint) => {
              if (bit === PermissionFlagsBits.Connect) return changes.Connect === false;
              if (bit === PermissionFlagsBits.ViewChannel) return changes.ViewChannel === false;
              return false;
            },
          },
        });
        return Promise.resolve(channel);
      }),
    },
    isVoiceBased: () => true,
    ...overrides,
  };
  return channel;
}

function fakeInteraction(customId: string, userId: string, voiceChannel: unknown) {
  return {
    customId,
    user: { id: userId, displayName: "user" },
    guild: {
      channels: { cache: { get: () => voiceChannel } },
      members: { cache: { get: () => undefined } },
      roles: { cache: { get: () => undefined } },
    },
    reply: mock(() => Promise.resolve()),
    update: mock(() => Promise.resolve()),
    showModal: mock(() => Promise.resolve()),
    deferUpdate: mock(() => Promise.resolve()),
    editReply: mock(() => Promise.resolve()),
    followUp: mock(() => Promise.resolve()),
  } as unknown as ButtonInteraction;
}

const ALWAYS_ALLOW_RENAME = () => true;

describe("handleTempVoiceButton", () => {
  test("temp-voice以外のcustomIdは無視する", async () => {
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() }, canRename: ALWAYS_ALLOW_RENAME } as unknown as HandleButtonDeps;
    const interaction = fakeInteraction("other:action:1", "owner-1", fakeVoiceChannel());

    await handleTempVoiceButton(deps, interaction);

    expect(interaction.reply).not.toHaveBeenCalled();
  });

  test("DBにレコードが無ければオーナー拒否メッセージを返す", async () => {
    const deps = { db: fakeDb(null), eventBus: { publish: mock() }, canRename: ALWAYS_ALLOW_RENAME } as unknown as HandleButtonDeps;
    const interaction = fakeInteraction("temp-voice:toggleLock:vc-1", "owner-1", fakeVoiceChannel());

    await handleTempVoiceButton(deps, interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("オーナー") }));
  });

  test("オーナー以外が押すと拒否メッセージを返す", async () => {
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() }, canRename: ALWAYS_ALLOW_RENAME } as unknown as HandleButtonDeps;
    const interaction = fakeInteraction("temp-voice:toggleLock:vc-1", "someone-else", fakeVoiceChannel());

    await handleTempVoiceButton(deps, interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("オーナー") }));
  });

  test("VCが既に削除されている場合は案内する", async () => {
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() }, canRename: ALWAYS_ALLOW_RENAME } as unknown as HandleButtonDeps;
    const interaction = fakeInteraction("temp-voice:toggleLock:vc-1", "owner-1", undefined);

    await handleTempVoiceButton(deps, interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("削除") }));
  });

  test("rename: レート制限内ならモーダルを表示する", async () => {
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() }, canRename: ALWAYS_ALLOW_RENAME } as unknown as HandleButtonDeps;
    const interaction = fakeInteraction("temp-voice:rename:vc-1", "owner-1", fakeVoiceChannel());

    await handleTempVoiceButton(deps, interaction);

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
  });

  test("rename: canRenameがfalseを返せばレート制限メッセージを返す", async () => {
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() }, canRename: () => false } as unknown as HandleButtonDeps;
    const interaction = fakeInteraction("temp-voice:rename:vc-1", "owner-1", fakeVoiceChannel());

    await handleTempVoiceButton(deps, interaction);

    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("しばらく") }));
  });

  test("userLimit/bitrate: モーダルを表示する", async () => {
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() }, canRename: ALWAYS_ALLOW_RENAME } as unknown as HandleButtonDeps;

    await handleTempVoiceButton(deps, fakeInteraction("temp-voice:userLimit:vc-1", "owner-1", fakeVoiceChannel()));
    await handleTempVoiceButton(deps, fakeInteraction("temp-voice:bitrate:vc-1", "owner-1", fakeVoiceChannel()));
  });

  test("toggleLock: 未ロックならConnectをfalseにし、deferUpdate+editReply+イベント発行する", async () => {
    const publish = mock(() => Promise.resolve());
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish }, canRename: ALWAYS_ALLOW_RENAME } as unknown as HandleButtonDeps;
    const voiceChannel = fakeVoiceChannel();
    const interaction = fakeInteraction("temp-voice:toggleLock:vc-1", "owner-1", voiceChannel);

    await handleTempVoiceButton(deps, interaction);

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(voiceChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      "everyone-id",
      { Connect: false },
      expect.objectContaining({ reason: expect.any(String) }),
    );
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ action: "permissionChanged", permission: "connect", allowed: false }),
    );
  });

  test("toggleLock: permissionOverwrites.editが失敗したらephemeralフォローアップを送り例外をthrowする", async () => {
    const publish = mock(() => Promise.resolve());
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish }, canRename: ALWAYS_ALLOW_RENAME } as unknown as HandleButtonDeps;
    const voiceChannel = fakeVoiceChannel({
      permissionOverwrites: {
        cache: { get: () => undefined },
        edit: mock(() => Promise.reject(new Error("missing permissions"))),
      },
    });
    const interaction = fakeInteraction("temp-voice:toggleLock:vc-1", "owner-1", voiceChannel);

    await expect(handleTempVoiceButton(deps, interaction)).rejects.toThrow();

    expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.any(String) }));
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  test("toggleHide: 未非表示ならViewChannelをfalseにする", async () => {
    const publish = mock(() => Promise.resolve());
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish }, canRename: ALWAYS_ALLOW_RENAME } as unknown as HandleButtonDeps;
    const voiceChannel = fakeVoiceChannel();
    const interaction = fakeInteraction("temp-voice:toggleHide:vc-1", "owner-1", voiceChannel);

    await handleTempVoiceButton(deps, interaction);

    expect(voiceChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      "everyone-id",
      { ViewChannel: false },
      expect.objectContaining({ reason: expect.any(String) }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ action: "permissionChanged", permission: "view", allowed: false }),
    );
  });

  test("permitMember: セレクトUIをephemeralでreplyする", async () => {
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() }, canRename: ALWAYS_ALLOW_RENAME } as unknown as HandleButtonDeps;
    const interaction = fakeInteraction("temp-voice:permitMember:vc-1", "owner-1", fakeVoiceChannel());

    await handleTempVoiceButton(deps, interaction);

    const replyArg = (interaction.reply as ReturnType<typeof mock>).mock.calls[0]?.[0];
    expect(JSON.stringify(replyArg)).toContain("temp-voice:permitMemberUser:vc-1");
  });

  test("denyMember: セレクトUIをephemeralでreplyする", async () => {
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() }, canRename: ALWAYS_ALLOW_RENAME } as unknown as HandleButtonDeps;
    const interaction = fakeInteraction("temp-voice:denyMember:vc-1", "owner-1", fakeVoiceChannel());

    await handleTempVoiceButton(deps, interaction);

    const replyArg = (interaction.reply as ReturnType<typeof mock>).mock.calls[0]?.[0];
    expect(JSON.stringify(replyArg)).toContain("temp-voice:denyMemberUser:vc-1");
  });

  test("manageMembers: 登録済みoverride一覧をephemeralでreplyする", async () => {
    const overrides = [{ channelId: "vc-1", targetType: "user", targetId: "user-1", state: "allow" }];
    const deps = { db: fakeDb(OWNED_ROW, overrides), eventBus: { publish: mock() }, canRename: ALWAYS_ALLOW_RENAME } as unknown as HandleButtonDeps;
    const interaction = fakeInteraction("temp-voice:manageMembers:vc-1", "owner-1", fakeVoiceChannel());

    await handleTempVoiceButton(deps, interaction);

    const replyArg = (interaction.reply as ReturnType<typeof mock>).mock.calls[0]?.[0];
    expect(JSON.stringify(replyArg)).toContain("temp-voice:removeMember:vc-1:user:user-1");
  });
});
