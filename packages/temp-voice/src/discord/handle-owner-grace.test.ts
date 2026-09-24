import { describe, expect, mock, test } from "bun:test";
import { handleOwnerGrace } from "./handle-owner-grace.js";

const CHANNEL_ROW = { channelId: "c1", guildId: "g1", controlChannelId: "ctrl-1", ownerId: "owner-1" };

function fakeDb(row: typeof CHANNEL_ROW | null) {
  const update = mock(() => ({ set: () => ({ where: () => Promise.resolve() }) }));
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve(row ? [row] : []) }) }),
    update,
  };
}

function fakeVoiceState(channelId: string | null, userId = "owner-1"): { channelId: string | null; id: string } {
  return { channelId, id: userId };
}

describe("handleOwnerGrace", () => {
  test("オーナーが自分の一時VCから退出したら猶予を開始する", async () => {
    const db = fakeDb(CHANNEL_ROW);

    await handleOwnerGrace({ db: db as never, gracePeriodMs: 600_000 }, fakeVoiceState("c1") as never, fakeVoiceState(null) as never);

    expect(db.update).toHaveBeenCalledTimes(1);
  });

  test("オーナー以外の退出では猶予を開始しない", async () => {
    const db = fakeDb(CHANNEL_ROW);

    await handleOwnerGrace(
      { db: db as never, gracePeriodMs: 600_000 },
      fakeVoiceState("c1", "other-user") as never,
      fakeVoiceState(null, "other-user") as never,
    );

    expect(db.update).not.toHaveBeenCalled();
  });

  test("オーナーが自分がオーナーの一時VCへ入室したら猶予を解除する", async () => {
    const db = fakeDb(CHANNEL_ROW);

    await handleOwnerGrace({ db: db as never, gracePeriodMs: 600_000 }, fakeVoiceState(null) as never, fakeVoiceState("c1") as never);

    expect(db.update).toHaveBeenCalledTimes(1);
  });

  test("channelId不変(ミュート等)は何もしない", async () => {
    const db = fakeDb(CHANNEL_ROW);

    await handleOwnerGrace({ db: db as never, gracePeriodMs: 600_000 }, fakeVoiceState("c1") as never, fakeVoiceState("c1") as never);

    expect(db.update).not.toHaveBeenCalled();
  });

  test("追跡対象外(temp-voiceでない)チャンネルの退出/入室は何もしない", async () => {
    const db = fakeDb(null);

    await handleOwnerGrace({ db: db as never, gracePeriodMs: 600_000 }, fakeVoiceState("untracked") as never, fakeVoiceState(null) as never);

    expect(db.update).not.toHaveBeenCalled();
  });

  test("同一オーナーの退出→即再入室を待たずに発火しても、findTempVoiceChannelの遅延に関わらず処理順が保たれる(codexレビュー指摘: 直列化していないとclearGracePeriodがstartGracePeriodより先に完了し猶予が残ってしまう)", async () => {
    let resolveFirstFind!: (value: (typeof CHANNEL_ROW)[]) => void;
    let callCount = 0;
    const updateCalls: string[] = [];
    const db = {
      select: () => ({
        from: () => ({
          where: () => {
            callCount += 1;
            // 1回目(退出時のfindTempVoiceChannel)だけ遅延させ、2回目(入室時)が先に完了しうる状況を再現する。
            if (callCount === 1) return new Promise<(typeof CHANNEL_ROW)[]>((resolve) => (resolveFirstFind = resolve));
            return Promise.resolve([CHANNEL_ROW]);
          },
        }),
      }),
      update: mock((table: unknown) => {
        void table;
        return {
          set: (values: Record<string, unknown>) => {
            updateCalls.push(values.gracePeriodOwnerId === null ? "clear" : "start");
            return { where: () => Promise.resolve() };
          },
        };
      }),
    };
    const deps = { db: db as never, gracePeriodMs: 600_000 };

    const leave = handleOwnerGrace(deps, fakeVoiceState("c1") as never, fakeVoiceState(null) as never);
    const rejoin = handleOwnerGrace(deps, fakeVoiceState(null) as never, fakeVoiceState("c1") as never);

    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveFirstFind([CHANNEL_ROW]);
    await Promise.all([leave, rejoin]);

    // 直列化されていれば必ずstart→clearの順になる(退出処理が完全に終わってから入室処理が始まる)。
    expect(updateCalls).toEqual(["start", "clear"]);
  });
});
