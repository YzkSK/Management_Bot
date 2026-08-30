import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import { Redis } from "ioredis";
import { DomainEventBus } from "./domain-events-bus.ts";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const STREAM = "domain-events:voice.session.ended";

async function isRedisAvailable(): Promise<boolean> {
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

function sampleEvent(overrides: Partial<{ guildId: string; userId: string; durationSeconds: number }> = {}) {
  return {
    type: "voice.session.ended" as const,
    guildId: overrides.guildId ?? "g1",
    userId: overrides.userId ?? "u1",
    channelId: "c1",
    startedAt: "2026-08-29T00:00:00.000Z",
    endedAt: "2026-08-29T00:10:00.000Z",
    durationSeconds: overrides.durationSeconds ?? 600,
  };
}

describe.skipIf(!(await isRedisAvailable()))("DomainEventBus", () => {
  afterEach(async () => {
    const raw = new Redis(REDIS_URL);
    await raw.del(STREAM);
    await raw.quit();
  });

  test("publishしたイベントをsubscribeで受信できる(別インスタンス間)", async () => {
    const group = randomUUID();
    const publisherBus = new DomainEventBus(REDIS_URL, group);
    const subscriberBus = new DomainEventBus(REDIS_URL, group);
    const received = Promise.withResolvers<unknown>();

    await subscriberBus.subscribe("voice.session.ended", (event) => received.resolve(event));
    await new Promise((r) => setTimeout(r, 100));
    await publisherBus.publish(sampleEvent());

    const event = await received.promise;
    expect(event).toMatchObject({ guildId: "g1", durationSeconds: 600 });
    await Promise.all([publisherBus.close(), subscriberBus.close()]);
  });

  test("不正なJSONペイロードでもプロセスを落とさずonErrorに通知する", async () => {
    const errors: unknown[] = [];
    const bus = new DomainEventBus(REDIS_URL, randomUUID(), (error) => errors.push(error));
    const raw = new Redis(REDIS_URL);

    await bus.subscribe("voice.session.ended", () => {
      throw new Error("should not be called");
    });
    await new Promise((r) => setTimeout(r, 100));
    await raw.xadd(STREAM, "*", "payload", "not json{{{");
    await new Promise((r) => setTimeout(r, 100));

    expect(errors.length).toBe(1);
    await raw.quit();
    await bus.close();
  });

  test("非同期handlerのrejectionが他handlerを妨げない", async () => {
    const errors: unknown[] = [];
    const secondCalled = Promise.withResolvers<void>();
    const bus = new DomainEventBus(REDIS_URL, randomUUID(), (error) => errors.push(error));

    await bus.subscribe("voice.session.ended", async () => {
      throw new Error("boom");
    });
    await bus.subscribe("voice.session.ended", () => secondCalled.resolve());
    await new Promise((r) => setTimeout(r, 100));
    await bus.publish(sampleEvent({ guildId: "g2", userId: "u2", durationSeconds: 1 }));

    await secondCalled.promise;
    await new Promise((r) => setTimeout(r, 50));
    expect(errors.length).toBe(1);
    await bus.close();
  });

  test("handlerが失敗したイベントはXACKされずPELに残る", async () => {
    const group = randomUUID();
    const bus = new DomainEventBus(REDIS_URL, group, () => {});

    await bus.subscribe("voice.session.ended", () => {
      throw new Error("boom");
    });
    await bus.publish(sampleEvent());
    await new Promise((r) => setTimeout(r, 200));
    await bus.close();

    const raw = new Redis(REDIS_URL);
    const pending = (await raw.xpending(STREAM, group)) as [number, string, string, unknown];
    expect(pending[0]).toBe(1);
    await raw.quit();
  });

  test("consumerが停止して再起動しても未ACKイベントをXAUTOCLAIMで回収して再処理する", async () => {
    const group = randomUUID();
    const raw = new Redis(REDIS_URL);
    await raw.xgroup("CREATE", STREAM, group, "0", "MKSTREAM");
    await raw.xadd(STREAM, "*", "payload", JSON.stringify(sampleEvent()));
    // 別consumer名で読み取るがACKしない(異常終了を模擬)。
    await raw.xreadgroup("GROUP", group, "stale-consumer", "COUNT", 10, "STREAMS", STREAM, ">");
    await raw.quit();

    const received = Promise.withResolvers<unknown>();
    const bus = new DomainEventBus(REDIS_URL, group, undefined, 0);
    await bus.subscribe("voice.session.ended", (event) => received.resolve(event));

    const event = await received.promise;
    expect(event).toMatchObject({ guildId: "g1" });
    await bus.close();
  });

  test("異なるconsumer groupは同一イベントをそれぞれ独立して受信する", async () => {
    const busA = new DomainEventBus(REDIS_URL, randomUUID());
    const busB = new DomainEventBus(REDIS_URL, randomUUID());
    const receivedA = Promise.withResolvers<unknown>();
    const receivedB = Promise.withResolvers<unknown>();

    await busA.subscribe("voice.session.ended", (event) => receivedA.resolve(event));
    await busB.subscribe("voice.session.ended", (event) => receivedB.resolve(event));
    await new Promise((r) => setTimeout(r, 100));
    await busA.publish(sampleEvent());

    await Promise.all([receivedA.promise, receivedB.promise]);
    await Promise.all([busA.close(), busB.close()]);
  });
});
