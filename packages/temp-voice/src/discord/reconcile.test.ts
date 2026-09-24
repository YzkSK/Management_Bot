import { describe, expect, mock, test } from "bun:test";
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import { lookupChannel, reconcileGuild } from "./reconcile.js";
import { EmptyChannelDeletionScheduler } from "./handle-empty-channel.js";
import { VoiceSessionStore } from "./voice-session-store.js";

function unknownChannelError() {
  return new DiscordAPIError({ message: "Unknown Channel", code: RESTJSONErrorCodes.UnknownChannel }, RESTJSONErrorCodes.UnknownChannel, 404, "GET", "/channels/x", { body: undefined, files: undefined });
}

function rateLimitedError() {
  return new DiscordAPIError({ message: "rate limited", code: 0 }, 0, 429, "GET", "/channels/x", { body: undefined, files: undefined });
}

const ROW = {
  channelId: "vc-1",
  guildId: "g1",
  controlChannelId: "ctrl-1",
  ownerId: "owner-1",
  gracePeriodOwnerId: null,
  gracePeriodEndsAt: null,
};
const CONFIG_ROW = {
  guildId: "g1",
  createChannelId: "create-ch",
  categoryId: "cat-1",
  nameTemplate: "{username}のVC",
  defaultUserLimit: 0,
  defaultBitrate: null,
};

function fakeDb(options: {
  rows?: (typeof ROW)[];
  config?: typeof CONFIG_ROW | null;
}) {
  const { rows = [], config = null } = options;
  let selectCallCount = 0;
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          selectCallCount += 1;
          // 1回目=listTempVoiceChannelsByGuild、2回目以降=getTempVoiceConfig(reconcileConfig/warnOrphanedChannels双方から呼ばれうる)。
          void table;
          if (selectCallCount === 1) return Promise.resolve(rows);
          return Promise.resolve(config ? [config] : []);
        },
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  };
}

function fakeVoiceChannel(id: string, memberIds: string[] = []) {
  return {
    id,
    isVoiceBased: () => true as const,
    members: new Map(memberIds.map((memberId) => [memberId, { id: memberId }])),
    delete: mock(() => Promise.resolve()),
  };
}

function fakeTextChannel(id: string) {
  return { id, isVoiceBased: () => false as const, delete: mock(() => Promise.resolve()) };
}

function fakeGuild(channels: Record<string, unknown>) {
  const byId = new Map(Object.entries(channels));
  return {
    id: "g1",
    channels: {
      cache: {
        get: (id: string) => byId.get(id),
        filter: () => new Map(),
      },
      fetch: (id: string) => Promise.resolve(byId.get(id) ?? null),
    },
  };
}

function fakeClient(guild: unknown) {
  return {
    guilds: {
      cache: { get: () => guild },
      fetch: () => Promise.resolve(guild),
    },
  };
}

describe("lookupChannel", () => {
  test("cacheにあればfoundを返す", async () => {
    const channel = fakeTextChannel("c1");
    const guild = fakeGuild({ c1: channel });

    const result = await lookupChannel(guild as never, "c1");

    expect(result).toEqual({ state: "found", channel: channel as never });
  });

  test("Unknown Channelエラーならnotfoundを返す(codexレビュー指摘: 確実に削除済みと判定できるケース)", async () => {
    const guild = { channels: { cache: { get: () => undefined }, fetch: () => Promise.reject(unknownChannelError()) } };

    const result = await lookupChannel(guild as never, "c1");

    expect(result).toEqual({ state: "notFound" });
  });

  test("レート制限等の一時的なエラーならindeterminateを返す(codexレビュー指摘: 削除済みと誤判定しない)", async () => {
    const guild = { channels: { cache: { get: () => undefined }, fetch: () => Promise.reject(rateLimitedError()) } };

    const result = await lookupChannel(guild as never, "c1");

    expect(result).toEqual({ state: "indeterminate" });
  });
});

describe("reconcileGuild", () => {
  test("チャンネル取得が判定不能(indeterminate)なら片肺と誤判定せず削除しない(codexレビュー指摘)", async () => {
    const guild = {
      id: "g1",
      channels: {
        cache: { get: () => undefined, filter: () => new Map() },
        fetch: () => Promise.reject(rateLimitedError()),
      },
    };
    const client = fakeClient(guild);
    const db = fakeDb({ rows: [ROW] });
    const publish = mock(() => Promise.resolve());
    const sessionStore = new VoiceSessionStore();
    const emptyChannelScheduler = new EmptyChannelDeletionScheduler();

    await reconcileGuild(
      { db: db as never, client: client as never, eventBus: { publish } as never, sessionStore, emptyChannelScheduler },
      "g1",
    );

    expect(publish).not.toHaveBeenCalled();
  });

  test("作成用VC/カテゴリの取得が判定不能なら設定をリセットしない(codexレビュー指摘)", async () => {
    const guild = {
      id: "g1",
      channels: {
        cache: { get: () => undefined, filter: () => new Map() },
        fetch: () => Promise.reject(rateLimitedError()),
      },
    };
    const client = fakeClient(guild);
    const updateSpy = mock(() => ({ set: () => ({ where: () => Promise.resolve() }) }));
    const db = { ...fakeDb({ rows: [], config: CONFIG_ROW }), update: updateSpy };
    const publish = mock(() => Promise.resolve());
    const sessionStore = new VoiceSessionStore();
    const emptyChannelScheduler = new EmptyChannelDeletionScheduler();

    await reconcileGuild(
      { db: db as never, client: client as never, eventBus: { publish } as never, sessionStore, emptyChannelScheduler },
      "g1",
    );

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("孤児判定の対象から制御チャンネルを除外する(codexレビュー指摘: 正常な制御チャンネルを孤児と誤警告しない)", async () => {
    const voiceChannel = fakeVoiceChannel("vc-1", ["owner-1"]);
    const controlChannel = fakeTextChannel("ctrl-1");
    const guild = fakeGuild({ "vc-1": voiceChannel, "ctrl-1": controlChannel });
    // カテゴリ配下の全チャンネル一覧をシミュレートし、実装側のfilter述語をそのまま適用する
    // (実際のCollection#filterと同じ挙動: 述語を無視せず反映することが重要)。
    const categoryChannels = new Map([["ctrl-1", { ...controlChannel, parentId: "cat-1" }]]);
    guild.channels.cache.filter = (predicate: (channel: { id: string; parentId: string }) => boolean) => {
      const matched = new Map([...categoryChannels].filter(([, channel]) => predicate(channel)));
      return matched;
    };
    const client = fakeClient(guild);
    const db = fakeDb({ rows: [ROW], config: CONFIG_ROW });
    const publish = mock(() => Promise.resolve());
    const sessionStore = new VoiceSessionStore();
    const emptyChannelScheduler = new EmptyChannelDeletionScheduler();
    const warnSpy = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warnSpy;

    try {
      await reconcileGuild(
        { db: db as never, client: client as never, eventBus: { publish } as never, sessionStore, emptyChannelScheduler },
        "g1",
      );
    } finally {
      console.warn = originalWarn;
    }

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("ctrl-1"));
  });
});

describe("reconcileGuild (basic scenarios)", () => {
  test("片肺(制御チャンネルが存在しない)なら残っているVCも削除しDB行を削除する", async () => {
    const voiceChannel = fakeVoiceChannel("vc-1");
    const guild = fakeGuild({ "vc-1": voiceChannel });
    const client = fakeClient(guild);
    const db = fakeDb({ rows: [ROW] });
    const publish = mock(() => Promise.resolve());
    const sessionStore = new VoiceSessionStore();
    const emptyChannelScheduler = new EmptyChannelDeletionScheduler();

    await reconcileGuild(
      { db: db as never, client: client as never, eventBus: { publish } as never, sessionStore, emptyChannelScheduler },
      "g1",
    );

    expect(voiceChannel.delete).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ action: "deleted", channelId: "vc-1" }));
  });

  test("片肺(VCが存在しない)なら残っている制御チャンネルも削除する", async () => {
    const controlChannel = fakeTextChannel("ctrl-1");
    const guild = fakeGuild({ "ctrl-1": controlChannel });
    const client = fakeClient(guild);
    const db = fakeDb({ rows: [ROW] });
    const publish = mock(() => Promise.resolve());
    const sessionStore = new VoiceSessionStore();
    const emptyChannelScheduler = new EmptyChannelDeletionScheduler();

    await reconcileGuild(
      { db: db as never, client: client as never, eventBus: { publish } as never, sessionStore, emptyChannelScheduler },
      "g1",
    );

    expect(controlChannel.delete).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ action: "deleted", channelId: "vc-1" }));
  });

  test("両方存在し無人なら削除猶予タイマーを再セットする(即時削除しない)", async () => {
    const voiceChannel = fakeVoiceChannel("vc-1", []);
    const controlChannel = fakeTextChannel("ctrl-1");
    const guild = fakeGuild({ "vc-1": voiceChannel, "ctrl-1": controlChannel });
    const client = fakeClient(guild);
    const db = fakeDb({ rows: [ROW] });
    const publish = mock(() => Promise.resolve());
    const sessionStore = new VoiceSessionStore();
    const emptyChannelScheduler = new EmptyChannelDeletionScheduler();
    const scheduleSpy = mock(emptyChannelScheduler.schedule.bind(emptyChannelScheduler));
    emptyChannelScheduler.schedule = scheduleSpy;

    await reconcileGuild(
      { db: db as never, client: client as never, eventBus: { publish } as never, sessionStore, emptyChannelScheduler },
      "g1",
    );

    expect(voiceChannel.delete).not.toHaveBeenCalled();
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    expect(scheduleSpy.mock.calls[0]?.[0]).toBe("vc-1");
    expect(sessionStore.isTracked("vc-1")).toBe(true);
  });

  test("両方存在し在室ありならセッションを起動時刻起点で再構築する", async () => {
    const voiceChannel = fakeVoiceChannel("vc-1", ["owner-1", "member-2"]);
    const controlChannel = fakeTextChannel("ctrl-1");
    const guild = fakeGuild({ "vc-1": voiceChannel, "ctrl-1": controlChannel });
    const client = fakeClient(guild);
    const db = fakeDb({ rows: [ROW] });
    const publish = mock(() => Promise.resolve());
    const sessionStore = new VoiceSessionStore();
    const emptyChannelScheduler = new EmptyChannelDeletionScheduler();
    const now = new Date("2026-09-24T00:00:00.000Z");

    await reconcileGuild(
      { db: db as never, client: client as never, eventBus: { publish } as never, sessionStore, emptyChannelScheduler },
      "g1",
      now,
    );

    expect(sessionStore.isTracked("vc-1")).toBe(true);
    expect(sessionStore.findLongestPresentUserId("vc-1")).not.toBeNull();
  });

  test("オーナー不在かつ猶予未登録なら猶予を開始する", async () => {
    const voiceChannel = fakeVoiceChannel("vc-1", ["member-2"]); // owner-1が不在
    const controlChannel = fakeTextChannel("ctrl-1");
    const guild = fakeGuild({ "vc-1": voiceChannel, "ctrl-1": controlChannel });
    const client = fakeClient(guild);
    const updateSpy = mock(() => ({ set: () => ({ where: () => Promise.resolve() }) }));
    const db = { ...fakeDb({ rows: [ROW] }), update: updateSpy };
    const publish = mock(() => Promise.resolve());
    const sessionStore = new VoiceSessionStore();
    const emptyChannelScheduler = new EmptyChannelDeletionScheduler();

    await reconcileGuild(
      { db: db as never, client: client as never, eventBus: { publish } as never, sessionStore, emptyChannelScheduler },
      "g1",
    );

    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  test("オーナー不在でも既に猶予登録済みなら二重登録しない", async () => {
    const rowWithGrace = { ...ROW, gracePeriodOwnerId: "owner-1", gracePeriodEndsAt: new Date("2026-09-24T00:10:00.000Z") };
    const voiceChannel = fakeVoiceChannel("vc-1", ["member-2"]);
    const controlChannel = fakeTextChannel("ctrl-1");
    const guild = fakeGuild({ "vc-1": voiceChannel, "ctrl-1": controlChannel });
    const client = fakeClient(guild);
    const updateSpy = mock(() => ({ set: () => ({ where: () => Promise.resolve() }) }));
    const db = { ...fakeDb({ rows: [rowWithGrace] }), update: updateSpy };
    const publish = mock(() => Promise.resolve());
    const sessionStore = new VoiceSessionStore();
    const emptyChannelScheduler = new EmptyChannelDeletionScheduler();

    await reconcileGuild(
      { db: db as never, client: client as never, eventBus: { publish } as never, sessionStore, emptyChannelScheduler },
      "g1",
    );

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("作成用VC・カテゴリがどちらも存在すれば設定をリセットしない", async () => {
    const createChannel = fakeTextChannel("create-ch");
    const category = fakeTextChannel("cat-1");
    const guild = fakeGuild({ "create-ch": createChannel, "cat-1": category });
    const client = fakeClient(guild);
    const updateSpy = mock(() => ({ set: () => ({ where: () => Promise.resolve() }) }));
    const db = { ...fakeDb({ rows: [], config: CONFIG_ROW }), update: updateSpy };
    const publish = mock(() => Promise.resolve());
    const sessionStore = new VoiceSessionStore();
    const emptyChannelScheduler = new EmptyChannelDeletionScheduler();

    await reconcileGuild(
      { db: db as never, client: client as never, eventBus: { publish } as never, sessionStore, emptyChannelScheduler },
      "g1",
    );

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("作成用VCが存在しなければ設定をリセットする", async () => {
    const category = fakeTextChannel("cat-1");
    const guild = fakeGuild({ "cat-1": category });
    const client = fakeClient(guild);
    const updateSpy = mock(() => ({ set: () => ({ where: () => Promise.resolve() }) }));
    const db = { ...fakeDb({ rows: [], config: CONFIG_ROW }), update: updateSpy };
    const publish = mock(() => Promise.resolve());
    const sessionStore = new VoiceSessionStore();
    const emptyChannelScheduler = new EmptyChannelDeletionScheduler();

    await reconcileGuild(
      { db: db as never, client: client as never, eventBus: { publish } as never, sessionStore, emptyChannelScheduler },
      "g1",
    );

    expect(updateSpy).toHaveBeenCalledTimes(1);
  });
});
