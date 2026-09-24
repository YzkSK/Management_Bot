import { describe, expect, mock, test } from "bun:test";
import { ChannelType } from "discord.js";
import type { VoiceState } from "discord.js";
import { handleVoiceCreate, type HandleVoiceCreateDeps } from "./voice-create.js";
import { VoiceSessionStore } from "./voice-session-store.js";

const CONFIG_ROW = {
  guildId: "g1",
  createChannelId: "create-ch",
  categoryId: "cat-1",
  nameTemplate: "{username}のVC",
  defaultUserLimit: 5,
  defaultBitrate: 96000,
};

const UNIQUE_VIOLATION_ERROR = Object.assign(new Error("duplicate key value violates unique constraint"), {
  code: "23505",
  constraint_name: "temp_voice_channels_guild_id_owner_id_key",
});

function fakeDb(options: {
  config?: typeof CONFIG_ROW | null;
  /** findOwnedTempVoiceChannelIdの呼び出しごとに順に返す値。省略時は毎回null(既存VCなし)。 */
  ownedChannelIdSequence?: (string | null)[];
  insertError?: unknown;
}) {
  const { config = CONFIG_ROW, ownedChannelIdSequence = [], insertError } = options;
  let selectCallCount = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => {
          selectCallCount += 1;
          // 1回目呼び出し=getTempVoiceConfig、2回目以降=findOwnedTempVoiceChannelId(呼び出し順は実装依存)。
          if (selectCallCount === 1) return Promise.resolve(config ? [config] : []);
          const ownedChannelId = ownedChannelIdSequence[selectCallCount - 2] ?? null;
          return Promise.resolve(ownedChannelId ? [{ channelId: ownedChannelId }] : []);
        },
      }),
    }),
    insert: () => ({
      values: () => (insertError ? Promise.reject(insertError) : Promise.resolve()),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  };
}

function fakeGuild(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "g1",
    roles: { everyone: { id: "everyone-role" } },
    members: { me: { id: "bot-id" } },
    client: { user: { id: "bot-id" } },
    channels: {
      cache: {
        get: mock(() => undefined),
        filter: mock(() => ({ size: 0 })),
      },
      create: mock(),
      fetch: mock(() => Promise.resolve(null)),
    },
    ...overrides,
  };
}

/**
 * guild.channels.createの戻り値として使うVCのfake。制御チャンネル送信直前に呼ばれる
 * readTempVoiceState(#408)がguild.roles.everyone.id/permissionOverwritesを参照するため必要。
 */
function fakeCreatedVoiceChannel(id: string, guild: unknown) {
  return {
    id,
    guild,
    userLimit: 5,
    bitrate: 96000,
    permissionOverwrites: { cache: { get: () => undefined } },
    delete: mock(() => Promise.resolve()),
  };
}

function fakeMember(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "user-1",
    displayName: "太郎",
    voice: { setChannel: mock(() => Promise.resolve()) },
    send: mock(() => Promise.resolve()),
    ...overrides,
  };
}

describe("handleVoiceCreate", () => {
  test("temp-voice未設定のギルドは何もしない", async () => {
    const db = fakeDb({ config: null });
    const eventBus = { publish: mock(() => Promise.resolve()) };
    const newState = { guild: fakeGuild(), member: fakeMember(), channelId: "create-ch" } as unknown as VoiceState;

    await handleVoiceCreate({ db, eventBus, sessionStore: new VoiceSessionStore() } as unknown as HandleVoiceCreateDeps, newState);

    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  test("作成用VC以外への入室は何もしない", async () => {
    const db = fakeDb({});
    const eventBus = { publish: mock(() => Promise.resolve()) };
    const guild = fakeGuild();
    const newState = { guild, member: fakeMember(), channelId: "some-other-channel" } as unknown as VoiceState;

    await handleVoiceCreate({ db, eventBus, sessionStore: new VoiceSessionStore() } as unknown as HandleVoiceCreateDeps, newState);

    expect(guild.channels.create).not.toHaveBeenCalled();
  });

  test("memberが取得できない(未キャッシュ)場合は何もしない", async () => {
    const db = fakeDb({});
    const eventBus = { publish: mock(() => Promise.resolve()) };
    const newState = { guild: fakeGuild(), member: null, channelId: "create-ch" } as unknown as VoiceState;

    await handleVoiceCreate({ db, eventBus, sessionStore: new VoiceSessionStore() } as unknown as HandleVoiceCreateDeps, newState);

    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  test("既にオーナーVCを持つユーザーは新規作成せず既存VCへ移動する", async () => {
    const db = fakeDb({ ownedChannelIdSequence: ["existing-vc"] });
    const eventBus = { publish: mock(() => Promise.resolve()) };
    const existingVoiceChannel = { isVoiceBased: () => true };
    const guild = fakeGuild({
      channels: {
        cache: { get: mock(() => existingVoiceChannel), filter: mock(() => ({ size: 0 })) },
        create: mock(),
      },
    });
    const member = fakeMember();
    const newState = { guild, member, channelId: "create-ch" } as unknown as VoiceState;

    await handleVoiceCreate({ db, eventBus, sessionStore: new VoiceSessionStore() } as unknown as HandleVoiceCreateDeps, newState);

    expect(member.voice.setChannel).toHaveBeenCalledWith(existingVoiceChannel);
    expect(guild.channels.create).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  test("既存VCがcacheに無い場合(bot再起動直後等)はfetchでフォールバックして移動する(codexレビュー指摘)", async () => {
    const db = fakeDb({ ownedChannelIdSequence: ["existing-vc"] });
    const eventBus = { publish: mock(() => Promise.resolve()) };
    const existingVoiceChannel = { isVoiceBased: () => true };
    const fetch = mock(() => Promise.resolve(existingVoiceChannel));
    const guild = fakeGuild({
      channels: {
        cache: { get: mock(() => undefined), filter: mock(() => ({ size: 0 })) },
        create: mock(),
        fetch,
      },
    });
    const member = fakeMember();
    const newState = { guild, member, channelId: "create-ch" } as unknown as VoiceState;

    await handleVoiceCreate({ db, eventBus, sessionStore: new VoiceSessionStore() } as unknown as HandleVoiceCreateDeps, newState);

    expect(fetch).toHaveBeenCalledWith("existing-vc");
    expect(member.voice.setChannel).toHaveBeenCalledWith(existingVoiceChannel);
  });

  test("既存VCがcache/fetchどちらでも見つからない(削除済み等)場合は何もしない", async () => {
    const db = fakeDb({ ownedChannelIdSequence: ["stale-vc"] });
    const eventBus = { publish: mock(() => Promise.resolve()) };
    const guild = fakeGuild({
      channels: {
        cache: { get: mock(() => undefined), filter: mock(() => ({ size: 0 })) },
        create: mock(),
        fetch: mock(() => Promise.reject(new Error("Unknown Channel"))),
      },
    });
    const member = fakeMember();
    const newState = { guild, member, channelId: "create-ch" } as unknown as VoiceState;

    await handleVoiceCreate({ db, eventBus, sessionStore: new VoiceSessionStore() } as unknown as HandleVoiceCreateDeps, newState);

    expect(member.voice.setChannel).not.toHaveBeenCalled();
    expect(guild.channels.create).not.toHaveBeenCalled();
  });

  test("カテゴリ上限到達時は作成せず本人にDMする", async () => {
    const db = fakeDb({});
    const eventBus = { publish: mock(() => Promise.resolve()) };
    const guild = fakeGuild({
      channels: {
        cache: {
          get: mock(() => ({ type: ChannelType.GuildCategory })),
          filter: mock(() => ({ size: 50 })),
        },
        create: mock(),
      },
    });
    const member = fakeMember();
    const newState = { guild, member, channelId: "create-ch" } as unknown as VoiceState;

    await handleVoiceCreate({ db, eventBus, sessionStore: new VoiceSessionStore() } as unknown as HandleVoiceCreateDeps, newState);

    expect(member.send).toHaveBeenCalledTimes(1);
    expect(guild.channels.create).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  test("正常系: VC・制御チャンネルを作成し移動・DB保存・イベント発行する", async () => {
    const db = fakeDb({});
    const eventBus = { publish: mock(() => Promise.resolve()) };
    const guild = fakeGuild({ channels: { cache: { get: mock(() => undefined), filter: mock(() => ({ size: 0 })) }, create: mock() } });
    const voiceChannel = fakeCreatedVoiceChannel("new-vc", guild);
    const controlChannel = {
      id: "new-control",
      delete: mock(() => Promise.resolve()),
      send: mock(() => Promise.resolve({ pin: mock(() => Promise.resolve()) })),
    };
    const create = mock((options: { type: ChannelType }) =>
      Promise.resolve(options.type === ChannelType.GuildVoice ? voiceChannel : controlChannel),
    );
    guild.channels.create = create;
    const member = fakeMember();
    const newState = { guild, member, channelId: "create-ch" } as unknown as VoiceState;

    await handleVoiceCreate({ db, eventBus, sessionStore: new VoiceSessionStore() } as unknown as HandleVoiceCreateDeps, newState);

    expect(create).toHaveBeenCalledTimes(2);
    expect(member.voice.setChannel).toHaveBeenCalledWith(voiceChannel);
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "temp-voice.event.recorded",
        action: "created",
        guildId: "g1",
        channelId: "new-vc",
        controlChannelId: "new-control",
        ownerId: "user-1",
        ownerName: "太郎",
      }),
    );
  });

  test("VC名は{username}を入室者の表示名に置換して生成する", async () => {
    const db = fakeDb({});
    const eventBus = { publish: mock(() => Promise.resolve()) };
    const guild = fakeGuild({ channels: { cache: { get: mock(() => undefined), filter: mock(() => ({ size: 0 })) }, create: mock() } });
    const voiceChannel = fakeCreatedVoiceChannel("new-vc", guild);
    const controlChannel = {
      id: "new-control",
      delete: mock(() => Promise.resolve()),
      send: mock(() => Promise.resolve({ pin: mock(() => Promise.resolve()) })),
    };
    const create = mock((options: { type: ChannelType }) =>
      Promise.resolve(options.type === ChannelType.GuildVoice ? voiceChannel : controlChannel),
    );
    guild.channels.create = create;
    const member = fakeMember({ displayName: "花子" });
    const newState = { guild, member, channelId: "create-ch" } as unknown as VoiceState;

    await handleVoiceCreate({ db, eventBus, sessionStore: new VoiceSessionStore() } as unknown as HandleVoiceCreateDeps, newState);

    expect(create.mock.calls[0]?.[0]).toMatchObject({ name: "花子のVC" });
  });

  test("制御チャンネル作成が失敗したらVCを削除してロールバックする(DBには書き込まない)", async () => {
    const db = fakeDb({});
    const eventBus = { publish: mock(() => Promise.resolve()) };
    const voiceChannel = { id: "new-vc", delete: mock(() => Promise.resolve()) };
    const create = mock((options: { type: ChannelType }) =>
      options.type === ChannelType.GuildVoice ? Promise.resolve(voiceChannel) : Promise.reject(new Error("missing permissions")),
    );
    const guild = fakeGuild({
      channels: { cache: { get: mock(() => undefined), filter: mock(() => ({ size: 0 })) }, create },
    });
    const member = fakeMember();
    const newState = { guild, member, channelId: "create-ch" } as unknown as VoiceState;

    await expect(handleVoiceCreate({ db, eventBus, sessionStore: new VoiceSessionStore() } as unknown as HandleVoiceCreateDeps, newState)).rejects.toThrow();

    expect(voiceChannel.delete).toHaveBeenCalledTimes(1);
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  test("DB INSERT失敗(想定外のエラー)時はDiscord側のVC・制御チャンネルを削除してロールバックし、例外を再throwする", async () => {
    const db = fakeDb({ insertError: new Error("connection lost") });
    const eventBus = { publish: mock(() => Promise.resolve()) };
    const guild = fakeGuild({ channels: { cache: { get: mock(() => undefined), filter: mock(() => ({ size: 0 })) }, create: mock() } });
    const voiceChannel = fakeCreatedVoiceChannel("new-vc", guild);
    const controlChannel = {
      id: "new-control",
      delete: mock(() => Promise.resolve()),
      send: mock(() => Promise.resolve({ pin: mock(() => Promise.resolve()) })),
    };
    guild.channels.create = mock((options: { type: ChannelType }) =>
      Promise.resolve(options.type === ChannelType.GuildVoice ? voiceChannel : controlChannel),
    );
    const member = fakeMember();
    const newState = { guild, member, channelId: "create-ch" } as unknown as VoiceState;

    await expect(handleVoiceCreate({ db, eventBus, sessionStore: new VoiceSessionStore() } as unknown as HandleVoiceCreateDeps, newState)).rejects.toThrow();

    expect(voiceChannel.delete).toHaveBeenCalledTimes(1);
    expect(controlChannel.delete).toHaveBeenCalledTimes(1);
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  test("DB INSERT失敗(unique制約違反=race condition敗北)時はDiscord側を削除し、勝者VCへ移動して正常終了する(codexレビュー指摘)", async () => {
    const db = fakeDb({ insertError: UNIQUE_VIOLATION_ERROR, ownedChannelIdSequence: [null, "winner-vc"] });
    const eventBus = { publish: mock(() => Promise.resolve()) };
    const winnerChannel = { isVoiceBased: () => true };
    const guild = fakeGuild({
      channels: {
        cache: { get: mock((id: string) => (id === "winner-vc" ? winnerChannel : undefined)), filter: mock(() => ({ size: 0 })) },
        create: mock(),
      },
    });
    const voiceChannel = fakeCreatedVoiceChannel("new-vc", guild);
    const controlChannel = {
      id: "new-control",
      delete: mock(() => Promise.resolve()),
      send: mock(() => Promise.resolve({ pin: mock(() => Promise.resolve()) })),
    };
    guild.channels.create = mock((options: { type: ChannelType }) =>
      Promise.resolve(options.type === ChannelType.GuildVoice ? voiceChannel : controlChannel),
    );
    const member = fakeMember();
    const newState = { guild, member, channelId: "create-ch" } as unknown as VoiceState;

    await handleVoiceCreate({ db, eventBus, sessionStore: new VoiceSessionStore() } as unknown as HandleVoiceCreateDeps, newState);

    expect(voiceChannel.delete).toHaveBeenCalledTimes(1);
    expect(controlChannel.delete).toHaveBeenCalledTimes(1);
    expect(member.voice.setChannel).toHaveBeenCalledWith(winnerChannel);
    expect(eventBus.publish).not.toHaveBeenCalled();
  });
});
