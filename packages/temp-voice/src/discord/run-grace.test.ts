import { describe, expect, mock, test } from "bun:test";
import { ChannelType } from "discord.js";
import { createGraceRunner, type GraceRunnerDeps } from "./run-grace.js";
import { VoiceSessionStore } from "./voice-session-store.js";

const EXPIRED_ROW = {
  channelId: "vc-1",
  guildId: "g1",
  controlChannelId: "ctrl-1",
  gracePeriodOwnerId: "old-owner",
  gracePeriodEndsAt: new Date("2026-01-01T00:00:00.000Z"),
};

const UNIQUE_VIOLATION_ERROR = Object.assign(new Error("duplicate key"), {
  code: "23505",
  constraint_name: "temp_voice_channels_guild_id_owner_id_key",
});

/**
 * casResults: update呼び出しごとの.returning()結果を順に返す(候補を除外して複数回呼ばれるケースの検証用)。
 * ownerAfterRollback: ロールバック時にrollbackGrantedViewerIfNotOwnerが呼ぶfindTempVoiceChannel
 * (deps.db経由、トランザクション外)が返す現在のownerId。デフォルトは元のオーナーのまま
 * (=候補者は現オーナーではない=権限剥奪が実行される、通常のロールバックケース)。
 */
function fakeDb(
  options: {
    expired?: (typeof EXPIRED_ROW)[];
    casResults?: ("committed" | "lostRace" | "uniqueViolation")[];
    lockAcquired?: boolean;
    ownerAfterRollback?: string;
  } = {},
) {
  const { expired = [EXPIRED_ROW], casResults = ["committed"], lockAcquired = true, ownerAfterRollback = "old-owner" } = options;
  let updateCallCount = 0;
  const tx = {
    execute: () => Promise.resolve([{ acquired: lockAcquired }]),
    select: () => ({ from: () => ({ where: () => Promise.resolve(expired) }) }),
  };
  return {
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    // rollbackGrantedViewerIfNotOwner内のfindTempVoiceChannelが参照する(非トランザクション経由)。
    select: () => ({
      from: () => ({
        where: () =>
          Promise.resolve([
            { channelId: expired[0]?.channelId ?? "vc-1", guildId: "g1", controlChannelId: "ctrl-1", ownerId: ownerAfterRollback },
          ]),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => {
            const result = casResults[updateCallCount] ?? casResults[casResults.length - 1];
            updateCallCount += 1;
            if (result === "uniqueViolation") return Promise.reject(UNIQUE_VIOLATION_ERROR);
            return Promise.resolve(result === "committed" ? [{ channelId: "vc-1" }] : []);
          },
        }),
      }),
    }),
  };
}

function fakeControlChannel() {
  return { id: "ctrl-1", type: ChannelType.GuildText, permissionOverwrites: { edit: mock(() => Promise.resolve()) } };
}

function fakeClient(controlChannel: unknown) {
  return {
    channels: { cache: { get: (id: string) => (id === "ctrl-1" ? controlChannel : undefined) } },
    guilds: { cache: { get: () => undefined } },
  };
}

describe("createGraceRunner", () => {
  test("誰も残っていないVCは何もしない", async () => {
    const controlChannel = fakeControlChannel();
    const publish = mock(() => Promise.resolve());
    const deps: GraceRunnerDeps = {
      db: fakeDb() as never,
      client: fakeClient(controlChannel) as never,
      eventBus: { publish } as never,
      sessionStore: new VoiceSessionStore(),
    };

    await createGraceRunner(deps, () => {}).run();

    expect(controlChannel.permissionOverwrites.edit).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  test("正常系: 最も長く滞在しているメンバーへ再割当し、ownerTransferred(trigger=autoGraceExpired)をpublishする", async () => {
    const controlChannel = fakeControlChannel();
    const publish = mock(() => Promise.resolve());
    const sessionStore = new VoiceSessionStore();
    sessionStore.startTrackingChannel("vc-1");
    sessionStore.recordJoin("vc-1", "new-owner", new Date("2026-01-01T00:00:00.000Z"));
    const deps: GraceRunnerDeps = {
      db: fakeDb() as never,
      client: fakeClient(controlChannel) as never,
      eventBus: { publish } as never,
      sessionStore,
    };

    await createGraceRunner(deps, () => {}).run();

    expect(controlChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      "new-owner",
      { ViewChannel: true },
      expect.objectContaining({ reason: expect.any(String) }),
    );
    expect(controlChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      "old-owner",
      { ViewChannel: null },
      expect.objectContaining({ reason: expect.any(String) }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ownerTransferred", trigger: "autoGraceExpired", previousOwnerId: "old-owner", newOwnerId: "new-owner" }),
    );
  });

  test("手動移譲が先にオーナーを変更していた場合(CAS失敗)、付与した権限をロールバックしイベントを発行しない(codexレビュー指摘: 手動移譲とcronの競合防止)", async () => {
    const controlChannel = fakeControlChannel();
    const publish = mock(() => Promise.resolve());
    const sessionStore = new VoiceSessionStore();
    sessionStore.startTrackingChannel("vc-1");
    sessionStore.recordJoin("vc-1", "new-owner", new Date("2026-01-01T00:00:00.000Z"));
    const deps: GraceRunnerDeps = {
      db: fakeDb({ casResults: ["lostRace"] }) as never,
      client: fakeClient(controlChannel) as never,
      eventBus: { publish } as never,
      sessionStore,
    };

    await createGraceRunner(deps, () => {}).run();

    expect(controlChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      "new-owner",
      { ViewChannel: true },
      expect.objectContaining({ reason: expect.any(String) }),
    );
    expect(controlChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      "new-owner",
      { ViewChannel: null },
      expect.objectContaining({ reason: expect.any(String) }),
    );
    expect(publish).not.toHaveBeenCalled();
  });

  test("最有力候補が既に別の一時VCのオーナーだった場合(unique制約違反)、次点の候補で再試行する(codexレビュー指摘)", async () => {
    const controlChannel = fakeControlChannel();
    const publish = mock(() => Promise.resolve());
    const sessionStore = new VoiceSessionStore();
    sessionStore.startTrackingChannel("vc-1");
    sessionStore.recordJoin("vc-1", "candidate-1", new Date("2026-01-01T00:00:00.000Z"));
    sessionStore.recordJoin("vc-1", "candidate-2", new Date("2026-01-01T00:01:00.000Z"));
    const deps: GraceRunnerDeps = {
      db: fakeDb({ casResults: ["uniqueViolation", "committed"] }) as never,
      client: fakeClient(controlChannel) as never,
      eventBus: { publish } as never,
      sessionStore,
    };

    await createGraceRunner(deps, () => {}).run();

    // 1人目(candidate-1)は権限付与→unique違反でロールバック。
    expect(controlChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      "candidate-1",
      { ViewChannel: true },
      expect.objectContaining({ reason: expect.any(String) }),
    );
    expect(controlChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      "candidate-1",
      { ViewChannel: null },
      expect.objectContaining({ reason: expect.any(String) }),
    );
    // 2人目(candidate-2)で再試行し成功する。
    expect(controlChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      "candidate-2",
      { ViewChannel: true },
      expect.objectContaining({ reason: expect.any(String) }),
    );
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ action: "ownerTransferred", newOwnerId: "candidate-2" }));
  });

  test("CAS敗北時、DB再確認で候補者が既に現オーナーになっていれば権限を剥奪しない(codexレビュー指摘: 無条件剥奪だと勝者の正当な権限を奪ってしまう)", async () => {
    const controlChannel = fakeControlChannel();
    const publish = mock(() => Promise.resolve());
    const sessionStore = new VoiceSessionStore();
    sessionStore.startTrackingChannel("vc-1");
    sessionStore.recordJoin("vc-1", "new-owner", new Date("2026-01-01T00:00:00.000Z"));
    const deps: GraceRunnerDeps = {
      // CASには負けるが、DBを再読込すると実は候補者(new-owner)自身が既に現オーナーになっている
      // (別プロセスが同じ候補を選んで先に確定させたケース)。
      db: fakeDb({ casResults: ["lostRace"], ownerAfterRollback: "new-owner" }) as never,
      client: fakeClient(controlChannel) as never,
      eventBus: { publish } as never,
      sessionStore,
    };

    await createGraceRunner(deps, () => {}).run();

    expect(controlChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      "new-owner",
      { ViewChannel: true },
      expect.objectContaining({ reason: expect.any(String) }),
    );
    expect(controlChannel.permissionOverwrites.edit).not.toHaveBeenCalledWith(
      "new-owner",
      { ViewChannel: null },
      expect.anything(),
    );
  });

  test("unique制約違反以外のDBエラー発生時も付与済み権限をロールバックしてから例外を伝播する(codexレビュー指摘)", async () => {
    const controlChannel = fakeControlChannel();
    const sessionStore = new VoiceSessionStore();
    sessionStore.startTrackingChannel("vc-1");
    sessionStore.recordJoin("vc-1", "new-owner", new Date("2026-01-01T00:00:00.000Z"));
    const db = fakeDb();
    (db as unknown as { update: () => unknown }).update = () => ({
      set: () => ({ where: () => ({ returning: () => Promise.reject(new Error("connection lost")) }) }),
    });
    const deps: GraceRunnerDeps = {
      db: db as never,
      client: fakeClient(controlChannel) as never,
      eventBus: { publish: mock() } as never,
      sessionStore,
    };

    // processExpiredChannel内の1チャンネル分のエラーはrun-grace.ts側でログされるのみで
    // ジョブ全体は継続する(他のチャンネルの処理を止めないため)。ここではロールバックが
    // 実行されたことのみを検証する。
    await createGraceRunner(deps, () => {}).run();

    expect(controlChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      "new-owner",
      { ViewChannel: null },
      expect.objectContaining({ reason: expect.any(String) }),
    );
  });

  test("advisory lock取得失敗時は何もしない(他インスタンスが実行中)", async () => {
    const controlChannel = fakeControlChannel();
    const publish = mock(() => Promise.resolve());
    const sessionStore = new VoiceSessionStore();
    sessionStore.startTrackingChannel("vc-1");
    sessionStore.recordJoin("vc-1", "new-owner", new Date());
    const deps: GraceRunnerDeps = {
      db: fakeDb({ lockAcquired: false }) as never,
      client: fakeClient(controlChannel) as never,
      eventBus: { publish } as never,
      sessionStore,
    };

    await createGraceRunner(deps, () => {}).run();

    expect(controlChannel.permissionOverwrites.edit).not.toHaveBeenCalled();
  });

  test("多重実行防止: 実行中に再度runを呼んでもスキップする", async () => {
    let resolveTransaction!: () => void;
    const db = {
      transaction: () =>
        new Promise((resolve) => {
          resolveTransaction = () => resolve([]);
        }),
    };
    const deps: GraceRunnerDeps = {
      db: db as never,
      client: fakeClient(fakeControlChannel()) as never,
      eventBus: { publish: mock() } as never,
      sessionStore: new VoiceSessionStore(),
    };
    const onResult = mock(() => {});
    const runner = createGraceRunner(deps, onResult);

    const firstRun = runner.run();
    await runner.run();
    resolveTransaction();
    await firstRun;

    expect(onResult).toHaveBeenCalledWith(expect.stringContaining("previous run is still active"));
  });
});
