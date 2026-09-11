import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, mock, test } from "bun:test";
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
import type { ModerationActionRecordedEvent } from "@management-bot/shared";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

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
 * 検証範囲はapplication層の連携まで(publish→subscribe→ログ書き込み)であり、
 * registerDiscordHandlers/BotClient.registerFeaturesによる実際の登録配線までは対象外。
 *
 * moderation.action.recordedはlogging自身の他のテスト(packages/logging)とも同一stream
 * (domain-events:moderation.action.recorded)を共有し、ローカル開発中は実行中のbotプロセスとも
 * 共有し得る。streamそのものは削除せず、テストごとに一意なguildIdを使い、購読側でも
 * そのguildId宛てのイベントだけを処理することで、他テスト・他プロセスの残留イベントの
 * 混入(consumer groupが起点ID"0"で作成され過去イベントを再配信すること含む)から隔離する。
 */
describe.skipIf(!(await isRedisAvailable()))("moderation → logging 複合テスト", () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const { db, close }: { db: Db; close: () => Promise<void> } = createDb(databaseUrl);
  const redis = new Redis(REDIS_URL);

  afterAll(async () => {
    await close();
    redis.disconnect();
  });

  test("連投→エスカレーション→moderation.action.recorded発行→loggingへのmoderationCase記録まで一気通貫で行われる", async () => {
    const guildId = `test-guild-${randomUUID()}`;
    const userId = `u-${randomUUID()}`;
    await db.insert(guilds).values({ id: guildId, name: "Test Guild" });
    // strong preset: windowSeconds=8, messageThreshold=3, strike1でmessageDelete
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });

    const runId = randomUUID();
    // 本番同様、機能ごとに別consumer groupを使う(同じgroupだと配信を取り合ってしまう)。
    const moderationEventBus = new DomainEventBus(REDIS_URL, `test-moderation-${runId}`);
    const loggingEventBus = new DomainEventBus(REDIS_URL, `test-logging-${runId}`);
    const sendToChannel = mock(() => Promise.resolve());
    const written = Promise.withResolvers<void>();

    try {
      await loggingEventBus.subscribe("moderation.action.recorded", async (event, entryId) => {
        if (event.guildId !== guildId) return; // 他テスト・他プロセスの残留イベントは無視する
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
      await db.delete(guilds).where(eq(guilds.id, guildId)); // cascadeで関連行も削除される
      const keys = await redis.keys(`moderation:*:${guildId}:*`);
      if (keys.length > 0) await redis.del(...keys);
    }
  });

  test("ホワイトリスト対象ユーザーは連投してもstrikeCount・ログのどちらも増加しない", async () => {
    const guildId = `test-guild-${randomUUID()}`;
    const userId = `u-${randomUUID()}`;
    await db.insert(guilds).values({ id: guildId, name: "Test Guild" });
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });
    await db.insert(moderationWhitelist).values({ guildId, targetType: "user", targetId: userId });

    const runId = randomUUID();
    const moderationEventBus = new DomainEventBus(REDIS_URL, `test-moderation-${runId}`);
    const loggingEventBus = new DomainEventBus(REDIS_URL, `test-logging-${runId}`);
    const sendToChannel = mock(() => Promise.resolve());
    const received: ModerationActionRecordedEvent[] = [];

    try {
      await loggingEventBus.subscribe("moderation.action.recorded", async (event, entryId) => {
        if (event.guildId !== guildId) return; // 他テスト・他プロセスの残留イベントは無視する
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
      await db.delete(guilds).where(eq(guilds.id, guildId));
      const keys = await redis.keys(`moderation:*:${guildId}:*`);
      if (keys.length > 0) await redis.del(...keys);
    }
  });
});
