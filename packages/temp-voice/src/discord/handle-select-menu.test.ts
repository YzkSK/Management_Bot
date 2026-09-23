import { describe, expect, mock, test } from "bun:test";
import type { RoleSelectMenuInteraction, UserSelectMenuInteraction } from "discord.js";
import { handleTempVoiceSelectMenu, type HandleSelectMenuDeps } from "./handle-select-menu.js";

const OWNED_ROW = { channelId: "vc-1", guildId: "g1", controlChannelId: "ctrl-1", ownerId: "owner-1" };

function fakeDb(row: typeof OWNED_ROW | null, isProtectedRole = false) {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(row ? [row] : []),
      }),
    }),
    insert: () => ({
      values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
    }),
    // isDenyProtectedRoleが内部でlistDenyProtectedRoleIds→selectを呼ぶための簡易スタブ。
    // roleId===guildIdの場合はDB問い合わせ前に判定されるため、ここでは常にprotectedRoles配列を返す。
    _isProtectedRole: isProtectedRole,
  };
}

function fakeVoiceChannel(overrides: Partial<Record<string, unknown>> = {}) {
  const channel: Record<string, unknown> = {
    id: "vc-1",
    guild: { roles: { everyone: { id: "everyone-id" } } },
    permissionOverwrites: {
      cache: { get: () => undefined },
      edit: mock(() => Promise.resolve(channel)),
    },
    members: { filter: () => new Map() },
    isVoiceBased: () => true,
    ...overrides,
  };
  return channel;
}

function fakeInteraction(
  customId: string,
  userId: string,
  voiceChannel: unknown,
  values: string[],
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    customId,
    user: { id: userId, displayName: "user" },
    values,
    guild: {
      channels: { cache: { get: () => voiceChannel } },
      members: { cache: { get: () => undefined } },
      roles: { cache: { get: () => undefined } },
    },
    reply: mock(() => Promise.resolve()),
    deferUpdate: mock(() => Promise.resolve()),
    editReply: mock(() => Promise.resolve()),
    followUp: mock(() => Promise.resolve()),
    ...overrides,
  } as unknown as RoleSelectMenuInteraction | UserSelectMenuInteraction;
}

describe("handleTempVoiceSelectMenu", () => {
  test("temp-voice以外のcustomIdは無視する", async () => {
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() } } as unknown as HandleSelectMenuDeps;
    const interaction = fakeInteraction("other:action:1", "owner-1", fakeVoiceChannel(), ["user-1"]);

    await handleTempVoiceSelectMenu(deps, interaction);

    expect(interaction.reply).not.toHaveBeenCalled();
  });

  test("オーナー以外が操作すると拒否メッセージを返す", async () => {
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() } } as unknown as HandleSelectMenuDeps;
    const interaction = fakeInteraction("temp-voice:permitMemberUser:vc-1", "someone-else", fakeVoiceChannel(), ["user-1"]);

    await handleTempVoiceSelectMenu(deps, interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("オーナー") }));
  });

  test("permitMemberUser: Connect:trueのoverwriteを付与しイベント発行する", async () => {
    const publish = mock(() => Promise.resolve());
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish } } as unknown as HandleSelectMenuDeps;
    const voiceChannel = fakeVoiceChannel();
    const interaction = fakeInteraction("temp-voice:permitMemberUser:vc-1", "owner-1", voiceChannel, ["user-1"]);

    await handleTempVoiceSelectMenu(deps, interaction);

    expect(voiceChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      "user-1",
      { Connect: true },
      expect.objectContaining({ reason: expect.any(String) }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ action: "memberPermissionChanged", state: "allow", targetType: "user", targetId: "user-1" }),
    );
  });

  test("denyMemberUser: VC内にいる対象ユーザーを切断する", async () => {
    const disconnect = mock(() => Promise.resolve());
    const voiceChannel = fakeVoiceChannel();
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() } } as unknown as HandleSelectMenuDeps;
    const interaction = fakeInteraction("temp-voice:denyMemberUser:vc-1", "owner-1", voiceChannel, ["user-1"], {
      guild: {
        channels: { cache: { get: () => voiceChannel } },
        members: { cache: { get: () => ({ id: "user-1", voice: { channelId: "vc-1", disconnect } }) } },
        roles: { cache: { get: () => undefined } },
      },
    });

    await handleTempVoiceSelectMenu(deps, interaction);

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  test("denyMemberRole: VC内で対象ロールを持つメンバー全員を切断する", async () => {
    const disconnectA = mock(() => Promise.resolve());
    const disconnectB = mock(() => Promise.resolve());
    const memberA = { id: "a", roles: { cache: { has: (id: string) => id === "role-1" } }, voice: { disconnect: disconnectA } };
    const memberB = { id: "b", roles: { cache: { has: (id: string) => id === "role-1" } }, voice: { disconnect: disconnectB } };
    const membersMap = new Map([
      ["a", memberA],
      ["b", memberB],
    ]);
    const voiceChannel = fakeVoiceChannel({ members: { filter: (predicate: (m: unknown) => boolean) => new Map([...membersMap].filter(([, m]) => predicate(m))) } });
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() } } as unknown as HandleSelectMenuDeps;
    const interaction = fakeInteraction("temp-voice:denyMemberRole:vc-1", "owner-1", voiceChannel, ["role-1"]);

    await handleTempVoiceSelectMenu(deps, interaction);

    expect(disconnectA).toHaveBeenCalledTimes(1);
    expect(disconnectB).toHaveBeenCalledTimes(1);
  });

  test("denyMemberRole: @everyone(roleId===guildId)は保護ロールとして拒否される", async () => {
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() } } as unknown as HandleSelectMenuDeps;
    const voiceChannel = fakeVoiceChannel();
    const interaction = fakeInteraction("temp-voice:denyMemberRole:vc-1", "owner-1", voiceChannel, ["g1"]);

    await handleTempVoiceSelectMenu(deps, interaction);

    expect(voiceChannel.permissionOverwrites.edit).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("拒否指定できません") }));
  });
});
