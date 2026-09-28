import { describe, expect, mock, test } from "bun:test";
import { VoiceSessionStore } from "./voice-session-store.js";

function fakeEventBus() {
  return { publish: mock(() => Promise.resolve()) };
}

describe("VoiceSessionStore", () => {
  test("startTrackingChannel後はisTrackedがtrueを返す", () => {
    const store = new VoiceSessionStore();
    expect(store.isTracked("c1")).toBe(false);
    store.startTrackingChannel("c1");
    expect(store.isTracked("c1")).toBe(true);
  });

  test("recordLeave: 開始時刻が記録されていればvoice.session.endedをpublishしメモリから除去する", async () => {
    const store = new VoiceSessionStore();
    const eventBus = fakeEventBus();
    store.startTrackingChannel("c1");
    const startedAt = new Date("2026-09-24T00:00:00.000Z");
    store.recordJoin("c1", "u1", startedAt);

    const endedAt = new Date("2026-09-24T00:05:00.000Z");
    await store.recordLeave(eventBus as never, "g1", "c1", "u1", endedAt);

    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "voice.session.ended",
        guildId: "g1",
        userId: "u1",
        channelId: "c1",
        durationSeconds: 300,
      }),
    );
  });

  test("recordLeave: 開始時刻が無ければpublishしない(bot起動前から入室していた等)", async () => {
    const store = new VoiceSessionStore();
    const eventBus = fakeEventBus();
    store.startTrackingChannel("c1");

    await store.recordLeave(eventBus as never, "g1", "c1", "u1", new Date());

    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  test("recordJoin: 追跡対象外のチャンネルは何もしない", async () => {
    const store = new VoiceSessionStore();
    const eventBus = fakeEventBus();
    store.recordJoin("untracked", "u1", new Date());

    await store.recordLeave(eventBus as never, "g1", "untracked", "u1", new Date());

    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  test("endAllSessionsForChannel: 残存メンバー全員分をpublishし追跡対象から除去する", async () => {
    const store = new VoiceSessionStore();
    const eventBus = fakeEventBus();
    store.startTrackingChannel("c1");
    store.recordJoin("c1", "u1", new Date("2026-09-24T00:00:00.000Z"));
    store.recordJoin("c1", "u2", new Date("2026-09-24T00:01:00.000Z"));

    await store.endAllSessionsForChannel(eventBus as never, "g1", "c1", new Date("2026-09-24T00:10:00.000Z"));

    expect(eventBus.publish).toHaveBeenCalledTimes(2);
    expect(store.isTracked("c1")).toBe(false);
  });

  test("endAllSessionsForChannel: 誰もいなければpublishしない", async () => {
    const store = new VoiceSessionStore();
    const eventBus = fakeEventBus();
    store.startTrackingChannel("c1");

    await store.endAllSessionsForChannel(eventBus as never, "g1", "c1", new Date());

    expect(eventBus.publish).not.toHaveBeenCalled();
    expect(store.isTracked("c1")).toBe(false);
  });

  test("discardChannel: publishせず追跡対象から除去する", async () => {
    const store = new VoiceSessionStore();
    store.startTrackingChannel("c1");
    store.recordJoin("c1", "u1", new Date());

    store.discardChannel("c1");

    expect(store.isTracked("c1")).toBe(false);
  });

  test("findLongestPresentUserId: 最も早くjoinしたユーザーを返す", () => {
    const store = new VoiceSessionStore();
    store.startTrackingChannel("c1");
    store.recordJoin("c1", "later", new Date("2026-09-24T00:05:00.000Z"));
    store.recordJoin("c1", "earliest", new Date("2026-09-24T00:00:00.000Z"));
    store.recordJoin("c1", "middle", new Date("2026-09-24T00:03:00.000Z"));

    expect(store.findLongestPresentUserId("c1")).toBe("earliest");
  });

  test("findLongestPresentUserId: 誰もいなければnullを返す", () => {
    const store = new VoiceSessionStore();
    store.startTrackingChannel("c1");

    expect(store.findLongestPresentUserId("c1")).toBeNull();
  });

  test("findLongestPresentUserId: 追跡対象外のチャンネルはnullを返す", () => {
    const store = new VoiceSessionStore();

    expect(store.findLongestPresentUserId("untracked")).toBeNull();
  });
});
