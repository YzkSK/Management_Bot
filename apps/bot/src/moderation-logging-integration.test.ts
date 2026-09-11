import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { DomainEventBus } from "@management-bot/core";
import {
  createDb,
  type Db,
  guilds,
  logEntries,
  moderationEscalationState,
  moderationThresholds,
  moderationWhitelist,
} from "@management-bot/db";
import { handleModerationEvent } from "@management-bot/logging";
import { detectAndEscalate, type IncomingMessage } from "@management-bot/moderation";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";

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

function message(overrides: Partial<IncomingMessage> & Pick<IncomingMessage, "guildId" | "userId">): IncomingMessage {
  return {
    messageId: randomUUID(),
    content: `msg-${randomUUID()}`,
    createdAt: new Date(),
    roleIds: [],
    ...overrides,
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

/**
 * moderation(#170)の垂直スライス全体を通しで検証する複合テスト(#176)。
 * 「短時間連投→strikeCount増加→moderation.action.recorded発行→loggingがmoderationCaseとして
 * 記録する」までを、moderation/loggingそれぞれのpackageを実際にimportし、Redis Streams経由の
 * 疎結合連携を含めて検証する(feature間の直接importは行わず、DomainEventBusのみを介する)。
 * この2機能をまたぐ検証はどちらのpackageにも属さないため、両方を実際に組み立てるapps/botに置く。
 */
describe.skipIf(!(await isRedisAvailable()))("moderation → logging 複合テスト", () => {
  let db: Db;
  let close: () => Promise<void>;
  const redis = new Redis(REDIS_URL);
  const guildId = `test-guild-${randomUUID()}`;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    ({ db, close } = createDb(databaseUrl));
    await db.insert(guilds).values({ id: guildId, name: "Test Guild" });
    // 他のテストファイル・過去の失敗実行が残したストリームの取りこぼしを防ぐ。
    await redis.del(STREAM);
  });

  afterAll(async () => {
    await db.delete(guilds).where(eq(guilds.id, guildId));
    await close();
    redis.disconnect();
  });

  afterEach(async () => {
    await db.delete(moderationThresholds).where(eq(moderationThresholds.guildId, guildId));
    await db.delete(moderationWhitelist).where(eq(moderationWhitelist.guildId, guildId));
    await db.delete(moderationEscalationState).where(eq(moderationEscalationState.guildId, guildId));
    await db.delete(logEntries).where(eq(logEntries.guildId, guildId));
    const keys = await redis.keys(`moderation:*:${guildId}:*`);
    if (keys.length > 0) await redis.del(...keys);
    // DomainEventBus.subscribeは新規consumer groupを起点ID"0"で作成するため、streamを
    // 消さないと前のテストで発行済みのイベントを次のテストの新しいgroupへ再配信してしまう。
    await redis.del(STREAM);
  });

  test("連投→エスカレーション→moderation.action.recorded発行→loggingへのmoderationCase記録まで一気通貫で行われる", async () => {
    const userId = `u-${randomUUID()}`;
    // strong preset: windowSeconds=8, messageThreshold=3, strike1でmessageDelete
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });

    const group = randomUUID();
    const moderationEventBus = new DomainEventBus(REDIS_URL, group);
    const loggingEventBus = new DomainEventBus(REDIS_URL, group);
    const sendToChannel = mock(() => Promise.resolve());
    const written = Promise.withResolvers<void>();

    try {
      await loggingEventBus.subscribe("moderation.action.recorded", async (event, entryId) => {
        await handleModerationEvent({ db, sendToChannel })(event, entryId);
        written.resolve();
      });
      await new Promise((r) => setTimeout(r, 100));

      const now = new Date();
      let lastOutcomes: Awaited<ReturnType<typeof detectAndEscalate>> = [];
      for (let i = 0; i < 3; i++) {
        lastOutcomes = await detectAndEscalate(
          { db, redis, eventBus: moderationEventBus },
          message({ guildId, userId, createdAt: new Date(now.getTime() + i * 1000) }),
        );
      }

      expect(lastOutcomes).toEqual([
        { violationType: "flood", strikeCount: 1, actionType: "messageDelete", caseId: expect.any(String) },
      ]);

      await withTimeout(written.promise, 5_000, "logging handler");

      const [row] = await db.select().from(logEntries).where(eq(logEntries.guildId, guildId));
      expect(row).toMatchObject({
        category: "moderationCase",
        payload: expect.objectContaining({
          category: "moderationCase",
          guildId,
          targetUserId: userId,
          actionType: "messageDelete",
          caseId: lastOutcomes[0]?.caseId,
        }),
      });

      const [state] = await db
        .select()
        .from(moderationEscalationState)
        .where(eq(moderationEscalationState.userId, userId));
      expect(state?.strikeCount).toBe(1);
    } finally {
      await Promise.all([moderationEventBus.close(), loggingEventBus.close()]);
    }
  });

  test("ホワイトリスト対象ユーザーは連投してもstrikeCount・ログのどちらも増加しない", async () => {
    const userId = `u-${randomUUID()}`;
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });
    await db.insert(moderationWhitelist).values({ guildId, targetType: "user", targetId: userId });

    const group = randomUUID();
    const moderationEventBus = new DomainEventBus(REDIS_URL, group);
    const loggingEventBus = new DomainEventBus(REDIS_URL, group);
    const sendToChannel = mock(() => Promise.resolve());
    const received: unknown[] = [];

    try {
      await loggingEventBus.subscribe("moderation.action.recorded", async (event, entryId) => {
        received.push(event);
        await handleModerationEvent({ db, sendToChannel })(event, entryId);
      });
      await new Promise((r) => setTimeout(r, 100));

      for (let i = 0; i < 5; i++) {
        await detectAndEscalate({ db, redis, eventBus: moderationEventBus }, message({ guildId, userId }));
      }
      // イベントが飛んでこないことを確認するため、購読が動作する猶予を与えてから判定する。
      await new Promise((r) => setTimeout(r, 300));

      expect(received).toEqual([]);
      expect(
        await db.select().from(moderationEscalationState).where(eq(moderationEscalationState.userId, userId)),
      ).toEqual([]);
      expect(await db.select().from(logEntries).where(eq(logEntries.guildId, guildId))).toEqual([]);
    } finally {
      await Promise.all([moderationEventBus.close(), loggingEventBus.close()]);
    }
  });
});
