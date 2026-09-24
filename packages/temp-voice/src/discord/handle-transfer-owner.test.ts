import { describe, expect, mock, test } from "bun:test";
import { ChannelType } from "discord.js";
import type { StringSelectMenuInteraction } from "discord.js";
import { handleTempVoiceTransferOwner, type HandleTransferOwnerDeps } from "./handle-transfer-owner.js";

const OWNED_ROW = { channelId: "vc-1", guildId: "g1", controlChannelId: "ctrl-1", ownerId: "owner-1" };

const UNIQUE_VIOLATION_ERROR = Object.assign(new Error("duplicate key"), {
  code: "23505",
  constraint_name: "temp_voice_channels_guild_id_owner_id_key",
});

/**
 * findTempVoiceChannel(1回目のselect)→findOwnedTempVoiceChannelId(2回目のselect、
 * 移譲先が既に別VCのオーナーでないかの事前チェック)の順で呼ばれる。
 * newOwnerOwnsAnotherChannel=trueなら2回目のselectが行を返す(=既に別VCのオーナー)。
 * transferResultは"committed"|"lostRace"|"uniqueViolation"のいずれか
 * (transferTempVoiceOwner自体のCASロジックはapplication層のDBテストで別途検証済みのため、
 * ここではhandleTempVoiceTransferOwnerが各結果に対してどう振る舞うかだけを検証する)。
 */
function fakeDb(
  row: typeof OWNED_ROW | null,
  transferResult: "committed" | "lostRace" | "uniqueViolation" = "committed",
  newOwnerOwnsAnotherChannel = false,
) {
  let selectCallCount = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => {
          selectCallCount += 1;
          if (selectCallCount === 1) return Promise.resolve(row ? [row] : []);
          return Promise.resolve(newOwnerOwnsAnotherChannel ? [{ channelId: "other-vc" }] : []);
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => {
            if (transferResult === "uniqueViolation") return Promise.reject(UNIQUE_VIOLATION_ERROR);
            return Promise.resolve(transferResult === "committed" ? [{ channelId: "vc-1" }] : []);
          },
        }),
      }),
    }),
  };
}

function fakeVoiceChannel(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "vc-1",
    guild: { roles: { everyone: { id: "everyone-id" } } },
    permissionOverwrites: { cache: { get: () => undefined } },
    userLimit: 5,
    bitrate: 64000,
    isVoiceBased: () => true,
    members: { get: (id: string) => (id === "member-1" ? { id: "member-1", displayName: "太郎" } : undefined) },
    ...overrides,
  };
}

function fakeControlChannel(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "ctrl-1",
    type: ChannelType.GuildText,
    permissionOverwrites: { edit: mock(() => Promise.resolve()) },
    ...overrides,
  };
}

function fakeInteraction(
  userId: string,
  voiceChannel: unknown,
  controlChannel: unknown,
  values: string[],
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    customId: "temp-voice:transferOwnerUser:vc-1:0",
    user: { id: userId, displayName: "user" },
    values,
    guild: { channels: { cache: { get: (id: string) => (id === "vc-1" ? voiceChannel : undefined) } } },
    client: { channels: { cache: { get: (id: string) => (id === "ctrl-1" ? controlChannel : undefined) } } },
    reply: mock(() => Promise.resolve()),
    deferUpdate: mock(() => Promise.resolve()),
    editReply: mock(() => Promise.resolve()),
    followUp: mock(() => Promise.resolve()),
    ...overrides,
  } as unknown as StringSelectMenuInteraction;
}

describe("handleTempVoiceTransferOwner", () => {
  test("temp-voice以外のcustomIdは無視する", async () => {
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() } } as unknown as HandleTransferOwnerDeps;
    const interaction = fakeInteraction("owner-1", fakeVoiceChannel(), fakeControlChannel(), ["member-1"], {
      customId: "other:action:1",
    });

    await handleTempVoiceTransferOwner(deps, interaction);

    expect(interaction.reply).not.toHaveBeenCalled();
  });

  test("オーナー以外が操作すると拒否メッセージを返す", async () => {
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() } } as unknown as HandleTransferOwnerDeps;
    const interaction = fakeInteraction("someone-else", fakeVoiceChannel(), fakeControlChannel(), ["member-1"]);

    await handleTempVoiceTransferOwner(deps, interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("オーナー") }));
  });

  test("選択先が既にVCを退出していればエラーメッセージを返す", async () => {
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish: mock() } } as unknown as HandleTransferOwnerDeps;
    const interaction = fakeInteraction("owner-1", fakeVoiceChannel(), fakeControlChannel(), ["left-already"]);

    await handleTempVoiceTransferOwner(deps, interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("退出") }));
  });

  test("正常系: 制御チャンネル権限を付け替え、DB更新後にownerTransferred(trigger=manual)をpublishする", async () => {
    const publish = mock(() => Promise.resolve());
    const controlChannel = fakeControlChannel();
    const deps = { db: fakeDb(OWNED_ROW), eventBus: { publish } } as unknown as HandleTransferOwnerDeps;
    const interaction = fakeInteraction("owner-1", fakeVoiceChannel(), controlChannel, ["member-1"]);

    await handleTempVoiceTransferOwner(deps, interaction);

    expect(controlChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      "member-1",
      { ViewChannel: true },
      expect.objectContaining({ reason: expect.any(String) }),
    );
    expect(controlChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      "owner-1",
      { ViewChannel: null },
      expect.objectContaining({ reason: expect.any(String) }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ownerTransferred", trigger: "manual", previousOwnerId: "owner-1", newOwnerId: "member-1" }),
    );
    expect(interaction.editReply).toHaveBeenCalled();
  });

  test("自動再割当cronが先にオーナーを変更していた場合(CAS失敗)、権限をロールバックしイベントを発行しない(codexレビュー指摘: 手動移譲とcronの競合防止)", async () => {
    const publish = mock(() => Promise.resolve());
    const controlChannel = fakeControlChannel();
    const db = fakeDb(OWNED_ROW, "lostRace");
    const deps = { db, eventBus: { publish } } as unknown as HandleTransferOwnerDeps;
    const interaction = fakeInteraction("owner-1", fakeVoiceChannel(), controlChannel, ["member-1"]);

    await handleTempVoiceTransferOwner(deps, interaction);

    expect(controlChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      "member-1",
      { ViewChannel: true },
      expect.objectContaining({ reason: expect.any(String) }),
    );
    expect(controlChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      "member-1",
      { ViewChannel: null },
      expect.objectContaining({ reason: expect.any(String) }),
    );
    expect(publish).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("既に他の処理") }));
  });

  test("移譲先が既に別の一時VCのオーナーなら事前チェックで拒否し、権限付け替えもDB更新も行わない(codexレビュー指摘: unique制約違反の未対応)", async () => {
    const controlChannel = fakeControlChannel();
    const deps = {
      db: fakeDb(OWNED_ROW, "committed", true),
      eventBus: { publish: mock() },
    } as unknown as HandleTransferOwnerDeps;
    const interaction = fakeInteraction("owner-1", fakeVoiceChannel(), controlChannel, ["member-1"]);

    await handleTempVoiceTransferOwner(deps, interaction);

    expect(controlChannel.permissionOverwrites.edit).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("既に別の一時VC") }));
  });

  test("事前チェックをすり抜けたrace conditionでunique制約違反が起きた場合も権限をロールバックする(codexレビュー指摘)", async () => {
    const publish = mock(() => Promise.resolve());
    const controlChannel = fakeControlChannel();
    const db = fakeDb(OWNED_ROW, "uniqueViolation");
    const deps = { db, eventBus: { publish } } as unknown as HandleTransferOwnerDeps;
    const interaction = fakeInteraction("owner-1", fakeVoiceChannel(), controlChannel, ["member-1"]);

    await handleTempVoiceTransferOwner(deps, interaction);

    expect(controlChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      "member-1",
      { ViewChannel: null },
      expect.objectContaining({ reason: expect.any(String) }),
    );
    expect(publish).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("既に別の一時VC") }));
  });

  test("制御チャンネルが見つからない場合は例外を投げDBを更新しない(codexレビュー指摘: 権限付け替え失敗を握りつぶさない)", async () => {
    const db = fakeDb(OWNED_ROW);
    const updateSpy = mock(db.update);
    const deps = { db: { ...db, update: updateSpy }, eventBus: { publish: mock() } } as unknown as HandleTransferOwnerDeps;
    const interaction = fakeInteraction("owner-1", fakeVoiceChannel(), undefined, ["member-1"]);

    await expect(handleTempVoiceTransferOwner(deps, interaction)).rejects.toThrow();

    expect(updateSpy).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("失敗") }));
  });
});
