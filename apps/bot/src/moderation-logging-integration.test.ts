import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { DomainEventBus } from "@management-bot/core";
import {
  createDb,
  type Db,
  guilds,
  logEntries,
  moderationEscalationState,
  moderationRaidState,
  moderationThresholds,
  moderationWhitelist,
} from "@management-bot/db";
import { handleModerationEvent } from "@management-bot/logging";
import {
  addNgword,
  createModerationConfigCache,
  detectAndEscalate,
  handleGuildMemberAdd,
  type IncomingGuildMember,
  type IncomingMessage,
  setEscalationPreset,
} from "@management-bot/moderation";
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
    channelId: "channel-1",
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
  let configCache = createModerationConfigCache();

  beforeEach(() => {
    configCache = createModerationConfigCache();
  });

  function withConfigCache<T extends object>(deps: T) {
    return { ...deps, configCache };
  }

  afterAll(async () => {
    await close();
    redis.disconnect();
  });

  test("連投→エスカレーション→moderation.action.recorded発行→loggingへのmoderationCase記録まで一気通貫で行われる", async () => {
    const guildId = `test-guild-${randomUUID()}`;
    const userId = `u-${randomUUID()}`;
    await db.insert(guilds).values({ id: guildId, name: "Test Guild" });
    // strong preset: windowSeconds=8, messageThreshold=3(検知条件)。
    // エスカレーション段階(統一ストライクカウンター、#311)はguild単位のescalationPresetで
    // 別管理されるため、こちらもstrongに設定する(strong: strikeCount>=1でwarn)。
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });
    await setEscalationPreset(db, guildId, "strong");

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
      let lastResult: Awaited<ReturnType<typeof detectAndEscalate>> = { outcomes: [], lockedMessageIds: [] };
      for (let i = 0; i < 3; i++) {
        lastResult = await detectAndEscalate(
          withConfigCache({ db, redis, eventBus: moderationEventBus, resolveInviteGuildId: async () => guildId }),
          message({ guildId, userId, createdAt: new Date(now.getTime() + i * 1000) }),
        );
      }

      expect(lastResult.outcomes).toEqual([
        {
          violationType: "flood",
          strikeCount: 1,
          actionType: "warn",
          caseId: expect.any(String),
          bufferedMessageIds: expect.any(Array),
        },
      ]);

      await withTimeout(written.promise, 5_000, "logging handler");

      const [row] = await db.select().from(logEntries).where(eq(logEntries.guildId, guildId));
      expect(row).toMatchObject({
        category: "moderationCase",
        payload: expect.objectContaining({
          category: "moderationCase",
          guildId,
          targetUserId: userId,
          actionType: "warn",
          caseId: lastResult.outcomes[0]?.caseId,
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
        await detectAndEscalate(withConfigCache({ db, redis, eventBus: moderationEventBus, resolveInviteGuildId: async () => guildId }), message({ guildId, userId }));
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

  /**
   * NGワード/メンションスパム検知(#177)の垂直スライス全体を通しで検証する複合テスト(#183)。
   * 「NGワード投稿→検知→moderation.action.recorded発行→loggingがmoderationCaseとして記録する」
   * までを検証する。連投/フラッドと同じエスカレーション・ログ連携基盤を再利用しているため、
   * 検証観点はflood版のテストと同様だが、判定トリガーがメッセージ本文であることを確認する。
   */
  test("NGワード投稿→検知→moderation.action.recorded発行→loggingへのmoderationCase記録まで一気通貫で行われる", async () => {
    const guildId = `test-guild-${randomUUID()}`;
    const userId = `u-${randomUUID()}`;
    await db.insert(guilds).values({ id: guildId, name: "Test Guild" });
    await db.insert(moderationThresholds).values({ guildId, violationType: "ngword", preset: "medium", enabled: true });
    await addNgword(db, guildId, "exact", "banned-word");
    await setEscalationPreset(db, guildId, "strong");

    const runId = randomUUID();
    const moderationEventBus = new DomainEventBus(REDIS_URL, `test-moderation-${runId}`);
    const loggingEventBus = new DomainEventBus(REDIS_URL, `test-logging-${runId}`);
    const sendToChannel = mock(() => Promise.resolve());
    const written = Promise.withResolvers<void>();

    try {
      await loggingEventBus.subscribe("moderation.action.recorded", async (event, entryId) => {
        if (event.guildId !== guildId) return;
        await handleModerationEvent({ db, sendToChannel })(event, entryId);
        written.resolve();
      });
      await new Promise((r) => setTimeout(r, 100));

      const result = await detectAndEscalate(
        withConfigCache({ db, redis, eventBus: moderationEventBus, resolveInviteGuildId: async () => guildId }),
        message({ guildId, userId, content: "banned-word" }),
      );

      expect(result.outcomes).toEqual([
        {
          violationType: "ngword",
          strikeCount: 1,
          actionType: "warn",
          caseId: expect.any(String),
          bufferedMessageIds: expect.any(Array),
        },
      ]);

      await withTimeout(written.promise, 5_000, "logging handler");

      const [row] = await db.select().from(logEntries).where(eq(logEntries.guildId, guildId));
      expect(row).toMatchObject({
        category: "moderationCase",
        payload: expect.objectContaining({
          category: "moderationCase",
          guildId,
          targetUserId: userId,
          actionType: "warn",
          caseId: result.outcomes[0]?.caseId,
        }),
      });
    } finally {
      await Promise.all([moderationEventBus.close(), loggingEventBus.close()]);
      await db.delete(guilds).where(eq(guilds.id, guildId));
      const keys = await redis.keys(`moderation:*:${guildId}:*`);
      if (keys.length > 0) await redis.del(...keys);
    }
  });

  /**
   * 短時間内の累積メンションスパム検知(#177)からエスカレーション適用までの複合テスト(#183)。
   * medium preset: cumulative.windowSeconds=10, mentionThreshold=10。1メッセージあたり
   * 単発閾値(6)未満の4件メンションを3通投稿し、合計12件で累積ヒットすることを確認する。
   */
  test("短時間大量メンション投稿→累積検知→エスカレーション適用まで一気通貫で行われる", async () => {
    const guildId = `test-guild-${randomUUID()}`;
    const userId = `u-${randomUUID()}`;
    await db.insert(guilds).values({ id: guildId, name: "Test Guild" });
    await db
      .insert(moderationThresholds)
      .values({ guildId, violationType: "mention_spam", preset: "medium", enabled: true });
    await setEscalationPreset(db, guildId, "strong");

    const runId = randomUUID();
    const moderationEventBus = new DomainEventBus(REDIS_URL, `test-moderation-${runId}`);
    const loggingEventBus = new DomainEventBus(REDIS_URL, `test-logging-${runId}`);
    const sendToChannel = mock(() => Promise.resolve());
    const written = Promise.withResolvers<void>();

    try {
      await loggingEventBus.subscribe("moderation.action.recorded", async (event, entryId) => {
        if (event.guildId !== guildId) return;
        await handleModerationEvent({ db, sendToChannel })(event, entryId);
        written.resolve();
      });
      await new Promise((r) => setTimeout(r, 100));

      const now = new Date();
      let lastResult: Awaited<ReturnType<typeof detectAndEscalate>> = { outcomes: [], lockedMessageIds: [] };
      for (let i = 0; i < 3; i++) {
        lastResult = await detectAndEscalate(
          withConfigCache({ db, redis, eventBus: moderationEventBus, resolveInviteGuildId: async () => guildId }),
          message({ guildId, userId, content: "<@1> <@2> <@3> <@4>", createdAt: new Date(now.getTime() + i * 1000) }),
        );
      }

      expect(lastResult.outcomes).toEqual([
        {
          violationType: "mention_spam",
          strikeCount: 1,
          actionType: "warn",
          caseId: expect.any(String),
          bufferedMessageIds: expect.any(Array),
        },
      ]);

      await withTimeout(written.promise, 5_000, "logging handler");

      const [row] = await db.select().from(logEntries).where(eq(logEntries.guildId, guildId));
      expect(row).toMatchObject({
        category: "moderationCase",
        payload: expect.objectContaining({
          category: "moderationCase",
          guildId,
          targetUserId: userId,
          actionType: "warn",
          caseId: lastResult.outcomes[0]?.caseId,
        }),
      });

      const [state] = await db
        .select()
        .from(moderationEscalationState)
        .where(eq(moderationEscalationState.userId, userId));
      expect(state?.strikeCount).toBe(1);
    } finally {
      await Promise.all([moderationEventBus.close(), loggingEventBus.close()]);
      await db.delete(guilds).where(eq(guilds.id, guildId));
      const keys = await redis.keys(`moderation:*:${guildId}:*`);
      if (keys.length > 0) await redis.del(...keys);
    }
  });

  /**
   * ホワイトリスト対象ユーザーがNGワード投稿・大量メンションを行っても、strikeCount・ログの
   * どちらも増加しないことを検証する(flood版のホワイトリストテストと同一方針、#183)。
   */
  test("ホワイトリスト対象ユーザーはNGワード投稿・大量メンションを行ってもstrikeCount・ログのどちらも増加しない", async () => {
    const guildId = `test-guild-${randomUUID()}`;
    const userId = `u-${randomUUID()}`;
    await db.insert(guilds).values({ id: guildId, name: "Test Guild" });
    await db.insert(moderationThresholds).values([
      { guildId, violationType: "ngword", preset: "medium", enabled: true },
      { guildId, violationType: "mention_spam", preset: "medium", enabled: true },
    ]);
    await addNgword(db, guildId, "exact", "banned-word");
    await db.insert(moderationWhitelist).values({ guildId, targetType: "user", targetId: userId });

    const runId = randomUUID();
    const moderationEventBus = new DomainEventBus(REDIS_URL, `test-moderation-${runId}`);
    const loggingEventBus = new DomainEventBus(REDIS_URL, `test-logging-${runId}`);
    const sendToChannel = mock(() => Promise.resolve());
    const received: ModerationActionRecordedEvent[] = [];

    try {
      await loggingEventBus.subscribe("moderation.action.recorded", async (event, entryId) => {
        if (event.guildId !== guildId) return;
        received.push(event);
        await handleModerationEvent({ db, sendToChannel })(event, entryId);
      });
      await new Promise((r) => setTimeout(r, 100));

      await detectAndEscalate(withConfigCache({ db, redis, eventBus: moderationEventBus, resolveInviteGuildId: async () => guildId }), message({ guildId, userId, content: "banned-word" }));
      const mentions = Array.from({ length: 6 }, (_, i) => `<@${i}>`).join(" ");
      await detectAndEscalate(withConfigCache({ db, redis, eventBus: moderationEventBus, resolveInviteGuildId: async () => guildId }), message({ guildId, userId, content: mentions }));
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

  /**
   * 招待リンク検知(#184)の垂直スライス全体を通しで検証する複合テスト(#190)。
   * 「他ギルド招待リンク投稿→検知→moderation.action.recorded発行→loggingがmoderationCaseとして
   * 記録する」までを検証する。resolveInviteGuildIdはfetchInvite相当の依存注入のため、
   * テストでは実際のDiscord APIを呼ばずモック関数で解決結果を制御する。
   */
  test("他ギルド招待リンク投稿→検知→moderation.action.recorded発行→loggingへのmoderationCase記録まで一気通貫で行われる", async () => {
    const guildId = `test-guild-${randomUUID()}`;
    const userId = `u-${randomUUID()}`;
    await db.insert(guilds).values({ id: guildId, name: "Test Guild" });
    await db.insert(moderationThresholds).values({ guildId, violationType: "invite_link", preset: "medium", enabled: true });
    await setEscalationPreset(db, guildId, "strong");

    const runId = randomUUID();
    const moderationEventBus = new DomainEventBus(REDIS_URL, `test-moderation-${runId}`);
    const loggingEventBus = new DomainEventBus(REDIS_URL, `test-logging-${runId}`);
    const sendToChannel = mock(() => Promise.resolve());
    const written = Promise.withResolvers<void>();

    try {
      await loggingEventBus.subscribe("moderation.action.recorded", async (event, entryId) => {
        if (event.guildId !== guildId) return;
        await handleModerationEvent({ db, sendToChannel })(event, entryId);
        written.resolve();
      });
      await new Promise((r) => setTimeout(r, 100));

      const result = await detectAndEscalate(
        withConfigCache({ db, redis, eventBus: moderationEventBus, resolveInviteGuildId: async () => "other-guild-id" }),
        message({ guildId, userId, content: "join us: discord.gg/other-guild-code" }),
      );

      expect(result.outcomes).toEqual([
        {
          violationType: "invite_link",
          strikeCount: 1,
          actionType: "warn",
          caseId: expect.any(String),
          bufferedMessageIds: expect.any(Array),
        },
      ]);

      await withTimeout(written.promise, 5_000, "logging handler");

      const [row] = await db.select().from(logEntries).where(eq(logEntries.guildId, guildId));
      expect(row).toMatchObject({
        category: "moderationCase",
        payload: expect.objectContaining({
          category: "moderationCase",
          guildId,
          targetUserId: userId,
          actionType: "warn",
          caseId: result.outcomes[0]?.caseId,
        }),
      });
    } finally {
      await Promise.all([moderationEventBus.close(), loggingEventBus.close()]);
      await db.delete(guilds).where(eq(guilds.id, guildId));
      const keys = await redis.keys(`moderation:*:${guildId}:*`);
      if (keys.length > 0) await redis.del(...keys);
    }
  });

  /**
   * 自ギルドのvanity URL(discord.ggのカスタムコード)は、fetchInvite解決結果のguildIdが
   * 自ギルドと一致するため検知されないことを確認する(spec: 自ギルド招待の除外節)。
   */
  test("自ギルドのvanity URL投稿は検知されない", async () => {
    const guildId = `test-guild-${randomUUID()}`;
    const userId = `u-${randomUUID()}`;
    await db.insert(guilds).values({ id: guildId, name: "Test Guild" });
    await db.insert(moderationThresholds).values({ guildId, violationType: "invite_link", preset: "medium", enabled: true });

    const runId = randomUUID();
    const moderationEventBus = new DomainEventBus(REDIS_URL, `test-moderation-${runId}`);
    const loggingEventBus = new DomainEventBus(REDIS_URL, `test-logging-${runId}`);
    const sendToChannel = mock(() => Promise.resolve());
    const received: ModerationActionRecordedEvent[] = [];

    try {
      await loggingEventBus.subscribe("moderation.action.recorded", async (event, entryId) => {
        if (event.guildId !== guildId) return;
        received.push(event);
        await handleModerationEvent({ db, sendToChannel })(event, entryId);
      });
      await new Promise((r) => setTimeout(r, 100));

      const result = await detectAndEscalate(
        withConfigCache({ db, redis, eventBus: moderationEventBus, resolveInviteGuildId: async () => guildId }),
        message({ guildId, userId, content: "join us: discord.gg/own-vanity-url" }),
      );
      await new Promise((r) => setTimeout(r, 300));

      expect(result.outcomes).toEqual([]);
      expect(received).toEqual([]);
      expect(await db.select().from(logEntries).where(eq(logEntries.guildId, guildId))).toEqual([]);
    } finally {
      await Promise.all([moderationEventBus.close(), loggingEventBus.close()]);
      await db.delete(guilds).where(eq(guilds.id, guildId));
      const keys = await redis.keys(`moderation:*:${guildId}:*`);
      if (keys.length > 0) await redis.del(...keys);
    }
  });

  /**
   * ホワイトリスト対象ユーザーが他ギルド招待リンクを投稿しても、strikeCount・ログの
   * どちらも増加しないことを検証する(flood/ngword版と同一方針、#190)。
   */
  test("ホワイトリスト対象ユーザーは他ギルド招待リンクを投稿してもstrikeCount・ログのどちらも増加しない", async () => {
    const guildId = `test-guild-${randomUUID()}`;
    const userId = `u-${randomUUID()}`;
    await db.insert(guilds).values({ id: guildId, name: "Test Guild" });
    await db.insert(moderationThresholds).values({ guildId, violationType: "invite_link", preset: "medium", enabled: true });
    await db.insert(moderationWhitelist).values({ guildId, targetType: "user", targetId: userId });

    const runId = randomUUID();
    const moderationEventBus = new DomainEventBus(REDIS_URL, `test-moderation-${runId}`);
    const loggingEventBus = new DomainEventBus(REDIS_URL, `test-logging-${runId}`);
    const sendToChannel = mock(() => Promise.resolve());
    const received: ModerationActionRecordedEvent[] = [];

    try {
      await loggingEventBus.subscribe("moderation.action.recorded", async (event, entryId) => {
        if (event.guildId !== guildId) return;
        received.push(event);
        await handleModerationEvent({ db, sendToChannel })(event, entryId);
      });
      await new Promise((r) => setTimeout(r, 100));

      await detectAndEscalate(
        withConfigCache({ db, redis, eventBus: moderationEventBus, resolveInviteGuildId: async () => "other-guild-id" }),
        message({ guildId, userId, content: "join us: discord.gg/other-guild-code" }),
      );
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

  function guildMember(
    overrides: Partial<IncomingGuildMember> & Pick<IncomingGuildMember, "guildId" | "userId">,
  ): IncomingGuildMember {
    const now = new Date();
    return { roleIds: [], accountCreatedAt: now, joinedAt: now, ...overrides };
  }

  async function cleanupRaidKeys(guildId: string): Promise<void> {
    const keys = [
      ...(await redis.keys(`moderation:raid:${guildId}`)),
      ...(await redis.keys(`moderation:raid-lock:${guildId}`)),
    ];
    if (keys.length > 0) await redis.del(...keys);
  }

  /**
   * レイド対策(大量入室検知、#191)の垂直スライス全体を通しで検証する複合テスト(#197)。
   * 「短時間大量入室(新規アカウント多数)→レイド検知→対象者一括timeout相当のイベント発行→
   * moderation.action.recorded複数発行→loggingに同一caseIdで相関記録される」までを検証する。
   * strong preset: window.memberThreshold=6, newAccountRatioThreshold=0.4。
   * 実際のDiscord API呼び出し(discord層のtimeout実行)はスコープ外で、
   * application層(handleGuildMemberAdd)がmoderation.action.recordedをpublishするところまでを検証する。
   */
  test("短時間大量入室(新規アカウント多数)→レイド検知→対象者全員へのmoderation.action.recorded発行→loggingに同一caseIdで相関記録される", async () => {
    const guildId = `test-guild-${randomUUID()}`;
    await db.insert(guilds).values({ id: guildId, name: "Test Guild" });
    await db.insert(moderationThresholds).values({ guildId, violationType: "raid", preset: "strong", enabled: true });

    const runId = randomUUID();
    const moderationEventBus = new DomainEventBus(REDIS_URL, `test-moderation-${runId}`);
    const loggingEventBus = new DomainEventBus(REDIS_URL, `test-logging-${runId}`);
    const sendToChannel = mock(() => Promise.resolve());
    const received: ModerationActionRecordedEvent[] = [];
    const allWritten = Promise.withResolvers<void>();

    try {
      await loggingEventBus.subscribe("moderation.action.recorded", async (event, entryId) => {
        if (event.guildId !== guildId) return;
        received.push(event);
        await handleModerationEvent({ db, sendToChannel })(event, entryId);
        if (received.length >= 6) allWritten.resolve();
      });
      await new Promise((r) => setTimeout(r, 100));

      const now = new Date();
      // strong preset: newAccountMaxAgeDays=14。全員作成1日以内(比率100%)なので
      // newAccountRatioThreshold(0.4)を超えseverity=highになる。
      const recentAccountCreatedAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const userIds = Array.from({ length: 6 }, () => `u-${randomUUID()}`);

      let lastResult: Awaited<ReturnType<typeof handleGuildMemberAdd>> | undefined;
      for (const userId of userIds) {
        lastResult = await handleGuildMemberAdd(
          withConfigCache({ db, redis, eventBus: moderationEventBus }),
          guildMember({ guildId, userId, accountCreatedAt: recentAccountCreatedAt, joinedAt: now }),
        );
      }

      expect(lastResult?.raidHit).not.toBeNull();
      expect(lastResult?.raidHit?.severity).toBe("high");
      expect(lastResult?.raidHit?.targetUserIds).toHaveLength(6);

      await withTimeout(allWritten.promise, 5_000, "logging handler");

      const caseId = lastResult?.raidHit?.caseId;
      expect(received).toHaveLength(6);
      expect(new Set(received.map((e) => e.caseId))).toEqual(new Set([caseId]));
      // 全対象者(6人)それぞれに個別のmoderation.action.recordedが発行されることを検証する
      // (Codexレビュー指摘: caseId・件数だけでは全員が同じユーザーを指していても通ってしまうため)。
      expect(new Set(received.map((e) => e.targetUserId))).toEqual(new Set(userIds));
      for (const event of received) {
        expect(event.actionType).toBe("timeout");
      }

      const rows = await db.select().from(logEntries).where(eq(logEntries.guildId, guildId));
      expect(rows).toHaveLength(6);
      const loggedTargetUserIds = rows.map((row) => {
        const payload = row.payload as { targetUserId?: unknown };
        return payload.targetUserId;
      });
      expect(new Set(loggedTargetUserIds)).toEqual(new Set(userIds));
      for (const row of rows) {
        expect(row).toMatchObject({
          category: "moderationCase",
          payload: expect.objectContaining({ category: "moderationCase", guildId, caseId, actionType: "timeout" }),
        });
      }

      const [raidState] = await db.select().from(moderationRaidState).where(eq(moderationRaidState.guildId, guildId));
      expect(raidState?.incidentCount).toBe(1);
    } finally {
      await Promise.all([moderationEventBus.close(), loggingEventBus.close()]);
      await db.delete(guilds).where(eq(guilds.id, guildId));
      await cleanupRaidKeys(guildId);
    }
  });

  /**
   * ホワイトリスト対象ユーザーの入室が、レイド判定の人数カウント(閾値到達自体を阻害しうる)から
   * 除外されることを検証する(設計spec「ホワイトリスト」節、#197)。
   * strong presetの閾値(6人)ちょうどの通常ユーザーではホワイトリスト対象を混ぜても
   * 「そもそもレイドが発生しない」ため一括アクション対象からの除外を検証できない
   * (Codexレビュー指摘)。通常ユーザーを閾値と同数(6人)入室させて実際にレイドを発生させたうえで、
   * ホワイトリスト対象の入室(6人の前後)がtargetUserIds・ログのどちらにも含まれないことを検証する。
   */
  test("ホワイトリスト対象ユーザーの入室はレイド判定の人数カウント・一括アクション対象から除外される", async () => {
    const guildId = `test-guild-${randomUUID()}`;
    await db.insert(guilds).values({ id: guildId, name: "Test Guild" });
    await db.insert(moderationThresholds).values({ guildId, violationType: "raid", preset: "strong", enabled: true });
    const whitelistedUserId = `u-${randomUUID()}`;
    await db.insert(moderationWhitelist).values({ guildId, targetType: "user", targetId: whitelistedUserId });

    const runId = randomUUID();
    const moderationEventBus = new DomainEventBus(REDIS_URL, `test-moderation-${runId}`);
    const loggingEventBus = new DomainEventBus(REDIS_URL, `test-logging-${runId}`);
    const sendToChannel = mock(() => Promise.resolve());
    const received: ModerationActionRecordedEvent[] = [];
    const allWritten = Promise.withResolvers<void>();

    try {
      await loggingEventBus.subscribe("moderation.action.recorded", async (event, entryId) => {
        if (event.guildId !== guildId) return;
        received.push(event);
        await handleModerationEvent({ db, sendToChannel })(event, entryId);
        if (received.length >= 6) allWritten.resolve();
      });
      await new Promise((r) => setTimeout(r, 100));

      const now = new Date();
      // ホワイトリスト対象を先に入室させる(バッファに積まれないため、後続の人数カウントに影響しない)。
      await handleGuildMemberAdd(
        withConfigCache({ db, redis, eventBus: moderationEventBus }),
        guildMember({ guildId, userId: whitelistedUserId, joinedAt: now }),
      );
      // strong presetの閾値は6人。通常ユーザーを6人ちょうど入室させ、実際にレイドを発生させる。
      const userIds = Array.from({ length: 6 }, () => `u-${randomUUID()}`);
      let lastResult: Awaited<ReturnType<typeof handleGuildMemberAdd>> | undefined;
      for (const userId of userIds) {
        lastResult = await handleGuildMemberAdd(
          withConfigCache({ db, redis, eventBus: moderationEventBus }),
          guildMember({ guildId, userId, joinedAt: now }),
        );
      }
      // レイド発生後にもホワイトリスト対象を入室させ、事後の入室もバッファ・対象に含まれないことを確認する。
      await handleGuildMemberAdd(
        withConfigCache({ db, redis, eventBus: moderationEventBus }),
        guildMember({ guildId, userId: whitelistedUserId, joinedAt: now }),
      );

      expect(lastResult?.raidHit).not.toBeNull();
      expect(lastResult?.raidHit?.targetUserIds).not.toContain(whitelistedUserId);
      expect(new Set(lastResult?.raidHit?.targetUserIds)).toEqual(new Set(userIds));

      await withTimeout(allWritten.promise, 5_000, "logging handler");

      expect(received).toHaveLength(6);
      expect(received.map((e) => e.targetUserId)).not.toContain(whitelistedUserId);

      const rows = await db.select().from(logEntries).where(eq(logEntries.guildId, guildId));
      expect(rows).toHaveLength(6);
      const loggedTargetUserIds = rows.map((row) => {
        const payload = row.payload as { targetUserId?: unknown };
        return payload.targetUserId;
      });
      expect(loggedTargetUserIds).not.toContain(whitelistedUserId);
    } finally {
      await Promise.all([moderationEventBus.close(), loggingEventBus.close()]);
      await db.delete(guilds).where(eq(guilds.id, guildId));
      await cleanupRaidKeys(guildId);
    }
  });

  /**
   * 新規アカウントガード(new_account_guard、#191)単体検知の垂直スライスを通しで検証する
   * 複合テスト(#197)。既存の共通エスカレーション処理(#173)にそのまま接続していることを、
   * 「作成間もないアカウントの入室→strike加算→moderation.action.recorded発行→
   * loggingへのmoderationCase記録」まで検証する。
   */
  test("作成間もないアカウントの入室→new_account_guard検知→エスカレーション適用→loggingへのmoderationCase記録まで一気通貫で行われる", async () => {
    const guildId = `test-guild-${randomUUID()}`;
    const userId = `u-${randomUUID()}`;
    await db.insert(guilds).values({ id: guildId, name: "Test Guild" });
    await db
      .insert(moderationThresholds)
      .values({ guildId, violationType: "new_account_guard", preset: "strong", enabled: true });
    await setEscalationPreset(db, guildId, "strong");

    const runId = randomUUID();
    const moderationEventBus = new DomainEventBus(REDIS_URL, `test-moderation-${runId}`);
    const loggingEventBus = new DomainEventBus(REDIS_URL, `test-logging-${runId}`);
    const sendToChannel = mock(() => Promise.resolve());
    const written = Promise.withResolvers<void>();

    try {
      await loggingEventBus.subscribe("moderation.action.recorded", async (event, entryId) => {
        if (event.guildId !== guildId) return;
        await handleModerationEvent({ db, sendToChannel })(event, entryId);
        written.resolve();
      });
      await new Promise((r) => setTimeout(r, 100));

      const now = new Date();
      const recentAccountCreatedAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const result = await handleGuildMemberAdd(
        withConfigCache({ db, redis, eventBus: moderationEventBus }),
        guildMember({ guildId, userId, accountCreatedAt: recentAccountCreatedAt, joinedAt: now }),
      );

      expect(result.newAccountGuardOutcome).toMatchObject({
        violationType: "new_account_guard",
        strikeCount: 1,
        actionType: "warn",
        caseId: expect.any(String),
      });

      await withTimeout(written.promise, 5_000, "logging handler");

      const [row] = await db.select().from(logEntries).where(eq(logEntries.guildId, guildId));
      expect(row).toMatchObject({
        category: "moderationCase",
        payload: expect.objectContaining({
          category: "moderationCase",
          guildId,
          targetUserId: userId,
          actionType: "warn",
          caseId: result.newAccountGuardOutcome?.caseId,
        }),
      });

      const [state] = await db
        .select()
        .from(moderationEscalationState)
        .where(eq(moderationEscalationState.userId, userId));
      expect(state?.strikeCount).toBe(1);
      expect(state?.violationType).toBe("new_account_guard");
    } finally {
      await Promise.all([moderationEventBus.close(), loggingEventBus.close()]);
      await db.delete(guilds).where(eq(guilds.id, guildId));
      await cleanupRaidKeys(guildId);
    }
  });

  /**
   * ホワイトリスト対象ユーザーは作成間もないアカウントで入室してもnew_account_guardの
   * strikeCount・ログのどちらも増加しないことを検証する(flood/ngword版と同一方針、#197)。
   */
  test("ホワイトリスト対象ユーザーは作成間もないアカウントで入室してもnew_account_guardのstrikeCount・ログのどちらも増加しない", async () => {
    const guildId = `test-guild-${randomUUID()}`;
    const userId = `u-${randomUUID()}`;
    await db.insert(guilds).values({ id: guildId, name: "Test Guild" });
    await db
      .insert(moderationThresholds)
      .values({ guildId, violationType: "new_account_guard", preset: "strong", enabled: true });
    await db.insert(moderationWhitelist).values({ guildId, targetType: "user", targetId: userId });

    const runId = randomUUID();
    const moderationEventBus = new DomainEventBus(REDIS_URL, `test-moderation-${runId}`);
    const loggingEventBus = new DomainEventBus(REDIS_URL, `test-logging-${runId}`);
    const sendToChannel = mock(() => Promise.resolve());
    const received: ModerationActionRecordedEvent[] = [];

    try {
      await loggingEventBus.subscribe("moderation.action.recorded", async (event, entryId) => {
        if (event.guildId !== guildId) return;
        received.push(event);
        await handleModerationEvent({ db, sendToChannel })(event, entryId);
      });
      await new Promise((r) => setTimeout(r, 100));

      const now = new Date();
      const recentAccountCreatedAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const result = await handleGuildMemberAdd(
        withConfigCache({ db, redis, eventBus: moderationEventBus }),
        guildMember({ guildId, userId, accountCreatedAt: recentAccountCreatedAt, joinedAt: now }),
      );
      await new Promise((r) => setTimeout(r, 300));

      expect(result.newAccountGuardOutcome).toBeNull();
      expect(received).toEqual([]);
      expect(
        await db.select().from(moderationEscalationState).where(eq(moderationEscalationState.userId, userId)),
      ).toEqual([]);
      expect(await db.select().from(logEntries).where(eq(logEntries.guildId, guildId))).toEqual([]);
    } finally {
      await Promise.all([moderationEventBus.close(), loggingEventBus.close()]);
      await db.delete(guilds).where(eq(guilds.id, guildId));
      await cleanupRaidKeys(guildId);
    }
  });
});
