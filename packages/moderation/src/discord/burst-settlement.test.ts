import { describe, expect, test } from "bun:test";
import { BurstSettlementCoordinator, type SettlementScheduler } from "./burst-settlement.js";

function fakeScheduler(): { scheduler: SettlementScheduler; runOnlyTimer: () => void } {
  let nextId = 0;
  const callbacks = new Map<number, () => void>();

  return {
    scheduler: {
      setTimeout(callback): ReturnType<typeof setTimeout> {
        const id = nextId++;
        callbacks.set(id, callback);
        return id as ReturnType<typeof setTimeout>;
      },
      clearTimeout(timer): void {
        callbacks.delete(timer as number);
      },
    },
    runOnlyTimer(): void {
      expect([...callbacks]).toHaveLength(1);
      const callback = [...callbacks.values()][0];
      if (!callback) throw new Error("timer callback is missing");
      callbacks.clear();
      callback();
    },
  };
}

describe("BurstSettlementCoordinator", () => {
  test("1秒の無投稿後に初回・後続メッセージを収束させる", async () => {
    const clock = fakeScheduler();
    const coordinator = new BurstSettlementCoordinator(clock.scheduler);
    const settled = coordinator.start({
      key: "guild:channel:user",
      initialMessageIds: ["first-1", "first-2"],
      maxAdditionalMessages: 3,
    });

    expect(coordinator.append("guild:channel:user", "later-1")).toBeTrue();
    clock.runOnlyTimer();

    await expect(settled).resolves.toEqual({
      messageIds: ["first-1", "first-2", "later-1"],
      reason: "quiet",
    });
  });

  test("後続投稿が上限に達するとタイマーを待たずに収束させる", async () => {
    const clock = fakeScheduler();
    const coordinator = new BurstSettlementCoordinator(clock.scheduler);
    const settled = coordinator.start({
      key: "guild:channel:user",
      initialMessageIds: ["first"],
      maxAdditionalMessages: 2,
    });

    expect(coordinator.append("guild:channel:user", "later-1")).toBeTrue();
    expect(coordinator.append("guild:channel:user", "later-2")).toBeTrue();

    await expect(settled).resolves.toEqual({
      messageIds: ["first", "later-1", "later-2"],
      reason: "limit",
    });
  });

  test("別のキーの投稿は収集しない", () => {
    const clock = fakeScheduler();
    const coordinator = new BurstSettlementCoordinator(clock.scheduler);
    void coordinator.start({ key: "guild:channel:user", initialMessageIds: ["first"], maxAdditionalMessages: 3 });

    expect(coordinator.append("guild:channel:other-user", "other-message")).toBeFalse();
  });

  test("収束後は同じキーで次のバーストを開始できる", async () => {
    const clock = fakeScheduler();
    const coordinator = new BurstSettlementCoordinator(clock.scheduler);
    const first = coordinator.start({ key: "guild:channel:user", initialMessageIds: ["first"], maxAdditionalMessages: 1 });

    coordinator.append("guild:channel:user", "later");
    await expect(first).resolves.toEqual({ messageIds: ["first", "later"], reason: "limit" });

    const second = coordinator.start({ key: "guild:channel:user", initialMessageIds: ["next"], maxAdditionalMessages: 1 });
    coordinator.append("guild:channel:user", "next-later");
    await expect(second).resolves.toEqual({ messageIds: ["next", "next-later"], reason: "limit" });
  });
});
