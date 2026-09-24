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
});
