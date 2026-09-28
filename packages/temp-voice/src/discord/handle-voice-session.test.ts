import { describe, expect, mock, test } from "bun:test";
import type { VoiceState } from "discord.js";
import { handleVoiceSession } from "./handle-voice-session.js";
import { VoiceSessionStore } from "./voice-session-store.js";

function fakeVoiceState(channelId: string | null, userId = "u1", guildId = "g1"): VoiceState {
  return { channelId, id: userId, guild: { id: guildId } } as unknown as VoiceState;
}

describe("handleVoiceSession", () => {
  test("channelId不変(ミュート等)は何もしない", async () => {
    const store = new VoiceSessionStore();
    store.startTrackingChannel("c1");
    const eventBus = { publish: mock(() => Promise.resolve()) };

    await handleVoiceSession({ eventBus: eventBus as never, sessionStore: store }, fakeVoiceState("c1"), fakeVoiceState("c1"));

    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  test("追跡対象チャンネルへのjoinはrecordJoinを呼ぶ(以後leaveで検証)", async () => {
    const store = new VoiceSessionStore();
    store.startTrackingChannel("c1");
    const eventBus = { publish: mock(() => Promise.resolve()) };

    await handleVoiceSession({ eventBus: eventBus as never, sessionStore: store }, fakeVoiceState(null), fakeVoiceState("c1"));
    await handleVoiceSession({ eventBus: eventBus as never, sessionStore: store }, fakeVoiceState("c1"), fakeVoiceState(null));

    expect(eventBus.publish).toHaveBeenCalledWith(expect.objectContaining({ type: "voice.session.ended", channelId: "c1" }));
  });

  test("追跡対象外チャンネルへのjoin/leaveは何も起きない", async () => {
    const store = new VoiceSessionStore();
    const eventBus = { publish: mock(() => Promise.resolve()) };

    await handleVoiceSession({ eventBus: eventBus as never, sessionStore: store }, fakeVoiceState(null), fakeVoiceState("untracked"));
    await handleVoiceSession({ eventBus: eventBus as never, sessionStore: store }, fakeVoiceState("untracked"), fakeVoiceState(null));

    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  test("追跡対象チャンネル間のmoveは旧チャンネルでleave・新チャンネルでjoinとして扱う", async () => {
    const store = new VoiceSessionStore();
    store.startTrackingChannel("c1");
    store.startTrackingChannel("c2");
    const eventBus = { publish: mock(() => Promise.resolve()) };

    await handleVoiceSession({ eventBus: eventBus as never, sessionStore: store }, fakeVoiceState(null), fakeVoiceState("c1"));
    await handleVoiceSession({ eventBus: eventBus as never, sessionStore: store }, fakeVoiceState("c1"), fakeVoiceState("c2"));

    expect(eventBus.publish).toHaveBeenCalledWith(expect.objectContaining({ type: "voice.session.ended", channelId: "c1" }));
    expect(store.findLongestPresentUserId("c2")).toBe("u1");
  });

  test("同一ユーザーの連続move(c1→c2→c3)を待たずに発火しても、publish遅延に関わらず処理順が保たれる(codexレビュー指摘)", async () => {
    const store = new VoiceSessionStore();
    store.startTrackingChannel("c1");
    store.startTrackingChannel("c2");
    store.startTrackingChannel("c3");
    // 1回目(c1→c2のleave)のpublishだけ遅延させ、2回目(c2→c3)が先に完了しうる状況を再現する。
    let resolveFirstPublish!: () => void;
    let callCount = 0;
    const eventBus = {
      publish: mock(() => {
        callCount += 1;
        if (callCount === 1) return new Promise<void>((resolve) => (resolveFirstPublish = resolve));
        return Promise.resolve();
      }),
    };
    const deps = { eventBus: eventBus as never, sessionStore: store };

    await handleVoiceSession(deps, fakeVoiceState(null), fakeVoiceState("c1"));
    const move1 = handleVoiceSession(deps, fakeVoiceState("c1"), fakeVoiceState("c2"));
    const move2 = handleVoiceSession(deps, fakeVoiceState("c2"), fakeVoiceState("c3"));

    // move2がc2のjoinを記録する前に完了してしまうと、findLongestPresentUserIdがc2に残ったままになる。
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveFirstPublish();
    await Promise.all([move1, move2]);

    expect(store.isTracked("c2")).toBe(true);
    expect(store.findLongestPresentUserId("c2")).toBeNull();
    expect(store.findLongestPresentUserId("c3")).toBe("u1");
  });
});
