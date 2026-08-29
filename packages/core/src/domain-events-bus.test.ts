import { describe, expect, test } from "bun:test";
import { DomainEventBus } from "./domain-events-bus.ts";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

async function isRedisAvailable(): Promise<boolean> {
  const { Redis } = await import("ioredis");
  const probe = new Redis(REDIS_URL, { retryStrategy: () => null, lazyConnect: true });
  try {
    await probe.connect();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

describe.skipIf(!(await isRedisAvailable()))("DomainEventBus", () => {
  test("publishしたイベントをsubscribeで受信できる(別インスタンス間)", async () => {
    const publisherBus = new DomainEventBus(REDIS_URL);
    const subscriberBus = new DomainEventBus(REDIS_URL);
    const received = Promise.withResolvers<unknown>();

    await subscriberBus.subscribe("voice.session.ended", (event) => received.resolve(event));
    await new Promise((r) => setTimeout(r, 100));
    await publisherBus.publish({
      type: "voice.session.ended",
      guildId: "g1",
      userId: "u1",
      channelId: "c1",
      startedAt: "2026-08-29T00:00:00.000Z",
      endedAt: "2026-08-29T00:10:00.000Z",
      durationSeconds: 600,
    });

    const event = await received.promise;
    expect(event).toMatchObject({ guildId: "g1", durationSeconds: 600 });
    await Promise.all([publisherBus.close(), subscriberBus.close()]);
  });

  test("不正なJSONペイロードでもプロセスを落とさずonErrorに通知する", async () => {
    const errors: unknown[] = [];
    const bus = new DomainEventBus(REDIS_URL, (error) => errors.push(error));
    const raw = new (await import("ioredis")).Redis(REDIS_URL);

    await bus.subscribe("voice.session.ended", () => {
      throw new Error("should not be called");
    });
    await new Promise((r) => setTimeout(r, 100));
    await raw.publish("domain-events:voice.session.ended", "not json{{{");
    await new Promise((r) => setTimeout(r, 100));

    expect(errors.length).toBe(1);
    await raw.quit();
    await bus.close();
  });

  test("非同期handlerのrejectionが他handlerを妨げない", async () => {
    const errors: unknown[] = [];
    const secondCalled = Promise.withResolvers<void>();
    const bus = new DomainEventBus(REDIS_URL, (error) => errors.push(error));

    await bus.subscribe("voice.session.ended", async () => {
      throw new Error("boom");
    });
    await bus.subscribe("voice.session.ended", () => secondCalled.resolve());
    await new Promise((r) => setTimeout(r, 100));
    await bus.publish({
      type: "voice.session.ended",
      guildId: "g2",
      userId: "u2",
      channelId: "c2",
      startedAt: "2026-08-29T00:00:00.000Z",
      endedAt: "2026-08-29T00:10:00.000Z",
      durationSeconds: 1,
    });

    await secondCalled.promise;
    await new Promise((r) => setTimeout(r, 50));
    expect(errors.length).toBe(1);
    await bus.close();
  });
});
