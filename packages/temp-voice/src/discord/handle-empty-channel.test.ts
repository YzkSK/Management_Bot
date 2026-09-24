import { describe, expect, mock, test } from "bun:test";
import { EmptyChannelDeletionScheduler, finalizeDeletion, handleEmptyChannel } from "./handle-empty-channel.js";
import { VoiceSessionStore } from "./voice-session-store.js";

const ROW = { channelId: "c1", guildId: "g1", controlChannelId: "ctrl-1", ownerId: "owner-1" };

function fakeDb(row: typeof ROW | null) {
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve(row ? [row] : []) }) }),
    delete: () => ({ where: () => Promise.resolve() }),
  };
}

function fakeGuild(options: {
  voiceChannel?: { id: string; isVoiceBased: () => true; members: { size: number }; delete: ReturnType<typeof mock> } | null;
  controlChannel?: { id: string; delete: ReturnType<typeof mock> } | null;
}) {
  const { voiceChannel, controlChannel } = options;
  const byId = new Map<string, unknown>();
  if (voiceChannel) byId.set(voiceChannel.id, voiceChannel);
  if (controlChannel) byId.set(controlChannel.id, controlChannel);
  return {
    channels: {
      cache: { get: (id: string) => byId.get(id) },
      fetch: (id: string) => Promise.resolve(byId.get(id) ?? null),
    },
  };
}

function fakeVoiceState(channel: { id: string; members: { size: number } } | null, guild: unknown, userId = "user-1") {
  return { channel, channelId: channel?.id ?? null, id: userId, guild };
}

describe("handleEmptyChannel", () => {
  test("追跡対象チャンネルが無人になったら猶予タイマーをセットする", () => {
    const sessionStore = new VoiceSessionStore();
    sessionStore.startTrackingChannel("c1");
    const scheduler = new EmptyChannelDeletionScheduler();
    const scheduleSpy = mock(scheduler.schedule.bind(scheduler));
    scheduler.schedule = scheduleSpy;

    const oldChannel = { id: "c1", members: { size: 0 } };
    handleEmptyChannel(
      { db: {} as never, eventBus: {} as never, sessionStore },
      scheduler,
      fakeVoiceState(oldChannel, {}) as never,
      fakeVoiceState(null, {}) as never,
    );

    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    expect(scheduleSpy.mock.calls[0]?.[0]).toBe("c1");
  });

  test("退出後もまだ他メンバーがいれば猶予タイマーをセットしない", () => {
    const sessionStore = new VoiceSessionStore();
    sessionStore.startTrackingChannel("c1");
    const scheduler = new EmptyChannelDeletionScheduler();
    const scheduleSpy = mock(scheduler.schedule.bind(scheduler));
    scheduler.schedule = scheduleSpy;

    const oldChannel = { id: "c1", members: { size: 1 } };
    handleEmptyChannel(
      { db: {} as never, eventBus: {} as never, sessionStore },
      scheduler,
      fakeVoiceState(oldChannel, {}) as never,
      fakeVoiceState(null, {}) as never,
    );

    expect(scheduleSpy).not.toHaveBeenCalled();
  });

  test("追跡対象外チャンネルの退出では何もしない", () => {
    const sessionStore = new VoiceSessionStore();
    const scheduler = new EmptyChannelDeletionScheduler();
    const scheduleSpy = mock(scheduler.schedule.bind(scheduler));
    scheduler.schedule = scheduleSpy;

    const oldChannel = { id: "untracked", members: { size: 0 } };
    handleEmptyChannel(
      { db: {} as never, eventBus: {} as never, sessionStore },
      scheduler,
      fakeVoiceState(oldChannel, {}) as never,
      fakeVoiceState(null, {}) as never,
    );

    expect(scheduleSpy).not.toHaveBeenCalled();
  });

  test("追跡対象チャンネルへ再入室したら猶予タイマーをキャンセルする", () => {
    const sessionStore = new VoiceSessionStore();
    sessionStore.startTrackingChannel("c1");
    const scheduler = new EmptyChannelDeletionScheduler();
    const cancelSpy = mock(scheduler.cancel.bind(scheduler));
    scheduler.cancel = cancelSpy;

    const newChannel = { id: "c1", members: { size: 1 } };
    handleEmptyChannel(
      { db: {} as never, eventBus: {} as never, sessionStore },
      scheduler,
      fakeVoiceState(null, {}) as never,
      fakeVoiceState(newChannel, {}) as never,
    );

    expect(cancelSpy).toHaveBeenCalledWith("c1");
  });

  test("channelId不変(ミュート等)は何もしない", () => {
    const sessionStore = new VoiceSessionStore();
    sessionStore.startTrackingChannel("c1");
    const scheduler = new EmptyChannelDeletionScheduler();
    const scheduleSpy = mock(scheduler.schedule.bind(scheduler));
    const cancelSpy = mock(scheduler.cancel.bind(scheduler));
    scheduler.schedule = scheduleSpy;
    scheduler.cancel = cancelSpy;

    const channel = { id: "c1", members: { size: 1 } };
    handleEmptyChannel(
      { db: {} as never, eventBus: {} as never, sessionStore },
      scheduler,
      fakeVoiceState(channel, {}) as never,
      fakeVoiceState(channel, {}) as never,
    );

    expect(scheduleSpy).not.toHaveBeenCalled();
    expect(cancelSpy).not.toHaveBeenCalled();
  });
});

describe("finalizeDeletion", () => {
  test("まだ無人ならVC・制御チャンネルを削除しdeletedイベントを発行する", async () => {
    const voiceDelete = mock(() => Promise.resolve());
    const controlDelete = mock(() => Promise.resolve());
    const voiceChannel = { id: "c1", isVoiceBased: () => true as const, members: { size: 0 }, delete: voiceDelete };
    const controlChannel = { id: "ctrl-1", delete: controlDelete };
    const guild = fakeGuild({ voiceChannel, controlChannel });
    const db = fakeDb(ROW);
    const publish = mock(() => Promise.resolve());
    const scheduler = new EmptyChannelDeletionScheduler();
    const generation = scheduler.schedule("c1", () => {}, 1_000_000);

    await finalizeDeletion({ db: db as never, eventBus: { publish } as never, sessionStore: new VoiceSessionStore() }, scheduler, guild as never, "c1", generation);

    expect(voiceDelete).toHaveBeenCalledTimes(1);
    expect(controlDelete).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    const event = publish.mock.calls[0]?.[0] as { action: string; channelId: string };
    expect(event.action).toBe("deleted");
    expect(event.channelId).toBe("c1");
  });

  test("再確認時に既に誰か入っていれば削除しない", async () => {
    const voiceDelete = mock(() => Promise.resolve());
    const voiceChannel = { id: "c1", isVoiceBased: () => true as const, members: { size: 1 }, delete: voiceDelete };
    const guild = fakeGuild({ voiceChannel });
    const db = fakeDb(ROW);
    const publish = mock(() => Promise.resolve());
    const scheduler = new EmptyChannelDeletionScheduler();
    const generation = scheduler.schedule("c1", () => {}, 1_000_000);

    await finalizeDeletion({ db: db as never, eventBus: { publish } as never, sessionStore: new VoiceSessionStore() }, scheduler, guild as never, "c1", generation);

    expect(voiceDelete).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  test("チャンネルが既に削除済み(取得不可)なら何もしない", async () => {
    const guild = fakeGuild({});
    const db = fakeDb(ROW);
    const publish = mock(() => Promise.resolve());
    const scheduler = new EmptyChannelDeletionScheduler();
    const generation = scheduler.schedule("c1", () => {}, 1_000_000);

    await finalizeDeletion({ db: db as never, eventBus: { publish } as never, sessionStore: new VoiceSessionStore() }, scheduler, guild as never, "c1", generation);

    expect(publish).not.toHaveBeenCalled();
  });

  test("DB上に一時VCとして存在しない(既に削除済み)なら何もしない", async () => {
    const voiceDelete = mock(() => Promise.resolve());
    const voiceChannel = { id: "c1", isVoiceBased: () => true as const, members: { size: 0 }, delete: voiceDelete };
    const guild = fakeGuild({ voiceChannel });
    const db = fakeDb(null);
    const publish = mock(() => Promise.resolve());
    const scheduler = new EmptyChannelDeletionScheduler();
    const generation = scheduler.schedule("c1", () => {}, 1_000_000);

    await finalizeDeletion({ db: db as never, eventBus: { publish } as never, sessionStore: new VoiceSessionStore() }, scheduler, guild as never, "c1", generation);

    expect(voiceDelete).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  test("世代が古い(await中にcancel/再scheduleされた)場合は削除しない(codexレビュー指摘のTOCTOU対策)", async () => {
    const voiceDelete = mock(() => Promise.resolve());
    const voiceChannel = { id: "c1", isVoiceBased: () => true as const, members: { size: 0 }, delete: voiceDelete };
    const guild = fakeGuild({ voiceChannel });
    const db = fakeDb(ROW);
    const publish = mock(() => Promise.resolve());
    const scheduler = new EmptyChannelDeletionScheduler();
    const staleGeneration = scheduler.schedule("c1", () => {}, 1_000_000);
    scheduler.cancel("c1"); // 再入室により世代が進む

    await finalizeDeletion(
      { db: db as never, eventBus: { publish } as never, sessionStore: new VoiceSessionStore() },
      scheduler,
      guild as never,
      "c1",
      staleGeneration,
    );

    expect(voiceDelete).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  test("Discord側のVC削除が失敗した場合、DB行は削除せずイベントも発行しない(codexレビュー指摘)", async () => {
    const voiceDelete = mock(() => Promise.reject(new Error("rate limited")));
    const voiceChannel = { id: "c1", isVoiceBased: () => true as const, members: { size: 0 }, delete: voiceDelete };
    const guild = fakeGuild({ voiceChannel });
    const dbDelete = mock(() => ({ where: () => Promise.resolve() }));
    const db = { ...fakeDb(ROW), delete: dbDelete };
    const publish = mock(() => Promise.resolve());
    const scheduler = new EmptyChannelDeletionScheduler();
    const generation = scheduler.schedule("c1", () => {}, 1_000_000);

    await finalizeDeletion({ db: db as never, eventBus: { publish } as never, sessionStore: new VoiceSessionStore() }, scheduler, guild as never, "c1", generation);

    expect(voiceDelete).toHaveBeenCalledTimes(1);
    expect(dbDelete).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("EmptyChannelDeletionScheduler", () => {
  test("猶予後にrunが呼ばれる", async () => {
    const scheduler = new EmptyChannelDeletionScheduler();
    const run = mock(() => {});

    scheduler.schedule("c1", run, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(run).toHaveBeenCalledTimes(1);
  });

  test("cancelするとrunは呼ばれない", async () => {
    const scheduler = new EmptyChannelDeletionScheduler();
    const run = mock(() => {});

    scheduler.schedule("c1", run, 1);
    scheduler.cancel("c1");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(run).not.toHaveBeenCalled();
  });

  test("再スケジュールすると前のタイマーは無効化される", async () => {
    const scheduler = new EmptyChannelDeletionScheduler();
    const firstRun = mock(() => {});
    const secondRun = mock(() => {});

    scheduler.schedule("c1", firstRun, 1);
    scheduler.schedule("c1", secondRun, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(firstRun).not.toHaveBeenCalled();
    expect(secondRun).toHaveBeenCalledTimes(1);
  });
});
