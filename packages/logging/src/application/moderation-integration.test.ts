import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { DomainEventBus } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import { Redis } from "ioredis";
import { handleModerationEvent } from "./handle-moderation-event.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const STREAM = "domain-events:moderation.action.recorded";

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

function fakeDb(inserts: { values: unknown }[]): Db {
  return {
    insert: () => ({
      values: (values: unknown) => {
        inserts.push({ values });
        return {
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([{ id: "generated" }]),
          }),
        };
      },
    }),
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  } as unknown as Db;
}

describe.skipIf(!(await isRedisAvailable()))("moderation.action.recorded 結合テスト", () => {
  afterEach(async () => {
    const raw = new Redis(REDIS_URL);
    await raw.del(STREAM);
    await raw.quit();
  });

  test("moderation側がpublishしたイベントをloggingが購読しログ書き込みまで完了する", async () => {
    const group = randomUUID();
    const publisherBus = new DomainEventBus(REDIS_URL, group);
    const subscriberBus = new DomainEventBus(REDIS_URL, group);
    const inserts: { values: unknown }[] = [];
    const db = fakeDb(inserts);
    const sendToChannel = mock(() => Promise.resolve());
    const written = Promise.withResolvers<void>();

    try {
      await subscriberBus.subscribe("moderation.action.recorded", async (event, entryId) => {
        await handleModerationEvent({ db, sendToChannel })(event, entryId);
        written.resolve();
      });
      await new Promise((r) => setTimeout(r, 100));

      await publisherBus.publish({
        type: "moderation.action.recorded",
        guildId: "g1",
        caseId: "case-1",
        targetUserId: "u1",
        moderatorId: "mod1",
        action: "create",
        actionType: "kick",
        createdAt: "2026-08-31T00:00:00.000Z",
      });

      let timeoutId: ReturnType<typeof setTimeout>;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("timed out waiting for handler")), 5_000);
      });
      try {
        await Promise.race([written.promise, timeout]);
      } finally {
        clearTimeout(timeoutId!);
      }
      expect(inserts[0]?.values).toMatchObject({
        guildId: "g1",
        category: "moderationCase",
        payload: { actionType: "kick", caseId: "case-1" },
      });
    } finally {
      await Promise.all([publisherBus.close(), subscriberBus.close()]);
    }
  });
});
