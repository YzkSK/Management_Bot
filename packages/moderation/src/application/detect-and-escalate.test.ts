import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  createDb,
  type Db,
  guilds,
  moderationEscalationState,
  moderationThresholds,
  moderationWhitelist,
} from "@management-bot/db";
import type { ModerationActionRecordedEvent } from "@management-bot/shared";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import {
  bufferedMessageIdsInWindow,
  detectAndEscalate,
  type IncomingMessage,
  SYSTEM_MODERATOR_ID,
} from "./detect-and-escalate.js";
import { incrementStrike } from "./escalation-state.js";
import { setEscalationPreset } from "./escalation-settings.js";
import type { BufferedMessage } from "./message-buffer.js";

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


describe.skipIf(!(await isRedisAvailable()))("detectAndEscalate", () => {
  let db: Db;
  let close: () => Promise<void>;
  const redis = new Redis(REDIS_URL);
  const guildId = `test-guild-${randomUUID()}`;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    ({ db, close } = createDb(databaseUrl));
    await db.insert(guilds).values({ id: guildId, name: "Test Guild" });
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
    const keys = await redis.keys(`moderation:*:${guildId}:*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  function fakeEventBus() {
    const published: ModerationActionRecordedEvent[] = [];
    return { published, publish: async (event: ModerationActionRecordedEvent) => void published.push(event) };
  }

  test("検知種別が何も有効でなければ何も起きない", async () => {
    const eventBus = fakeEventBus();
    const result = await detectAndEscalate(
      { db, redis, eventBus },
      message({ guildId, userId: `u-${randomUUID()}` }),
    );
    expect(result).toEqual([]);
    expect(eventBus.published).toEqual([]);
  });

  test("ホワイトリスト対象ユーザーは連投してもstrikeCountが増加しない", async () => {
    const userId = `u-${randomUUID()}`;
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });
    await db.insert(moderationWhitelist).values({ guildId, targetType: "user", targetId: userId });

    const eventBus = fakeEventBus();
    for (let i = 0; i < 5; i++) {
      await detectAndEscalate({ db, redis, eventBus }, message({ guildId, userId }));
    }

    expect(eventBus.published).toEqual([]);
    const rows = await db
      .select()
      .from(moderationEscalationState)
      .where(eq(moderationEscalationState.userId, userId));
    expect(rows).toEqual([]);
  });

  test("連投がstrong presetの頻度閾値に達するとstrikeCountが増加しアクションがpublishされる", async () => {
    const userId = `u-${randomUUID()}`;
    // strong preset: windowSeconds=8, messageThreshold=3, 合計strikeCount=1でESCALATION_STEPS.strong[1]=messageDelete
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });
    await setEscalationPreset(db, guildId, "strong");

    const eventBus = fakeEventBus();
    const now = new Date();
    let lastResult: Awaited<ReturnType<typeof detectAndEscalate>> = [];
    for (let i = 0; i < 3; i++) {
      lastResult = await detectAndEscalate(
        { db, redis, eventBus },
        message({ guildId, userId, createdAt: new Date(now.getTime() + i * 1000) }),
      );
    }

    expect(lastResult).toEqual([
      {
        violationType: "flood",
        strikeCount: 1,
        actionType: "messageDelete",
        caseId: expect.any(String),
        bufferedMessageIds: expect.any(Array),
      },
    ]);
    expect(eventBus.published).toHaveLength(1);
    expect(eventBus.published[0]).toMatchObject({
      type: "moderation.action.recorded",
      guildId,
      targetUserId: userId,
      moderatorId: SYSTEM_MODERATOR_ID,
      action: "create",
      actionType: "messageDelete",
    });

    const [row] = await db
      .select()
      .from(moderationEscalationState)
      .where(eq(moderationEscalationState.userId, userId));
    expect(row?.strikeCount).toBe(1);
  });

  test("同一バースト中の連投は閾値超過後も追加でヒットし続けるが、strikeCountは1回しか加算されない", async () => {
    const userId = `u-${randomUUID()}`;
    // strong preset: windowSeconds=8, messageThreshold=3
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });
    await setEscalationPreset(db, guildId, "strong");

    const eventBus = fakeEventBus();
    const now = new Date();
    const results: Awaited<ReturnType<typeof detectAndEscalate>>[] = [];
    // 8秒以内に7通連投。3通目以降は毎回messageThreshold(3件)を超過し続けるが、
    // ロックにより2通目以降の超過ではstrikeCountを進めない想定。
    for (let i = 0; i < 7; i++) {
      results.push(
        await detectAndEscalate(
          { db, redis, eventBus },
          message({ guildId, userId, createdAt: new Date(now.getTime() + i * 500) }),
        ),
      );
    }

    const hits = results.filter((r) => r.length > 0);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual([
      {
        violationType: "flood",
        strikeCount: 1,
        actionType: "messageDelete",
        caseId: expect.any(String),
        bufferedMessageIds: expect.any(Array),
      },
    ]);
    expect(eventBus.published).toHaveLength(1);

    const [row] = await db
      .select()
      .from(moderationEscalationState)
      .where(eq(moderationEscalationState.userId, userId));
    expect(row?.strikeCount).toBe(1);
  });

  test("bufferedMessageIdsは検知トリガーと同一チャンネルかつwindowSeconds以内のメッセージのみに絞られる", async () => {
    const userId = `u-${randomUUID()}`;
    // strong preset: windowSeconds=8, messageThreshold=3
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });

    const eventBus = fakeEventBus();
    const now = new Date();
    // 1件目は別チャンネル(channel-other)、2・3件目はchannel-1。
    // flood検知(件数)はチャンネルを跨いで動作する設計のため3件目でヒットするが、
    // bufferedMessageIdsにはchannel-1の2件のみが残るべき(channel-otherの1件目は除外)。
    const otherChannelMessageId = randomUUID();
    await detectAndEscalate(
      { db, redis, eventBus },
      message({ guildId, userId, channelId: "channel-other", messageId: otherChannelMessageId, createdAt: now }),
    );
    const secondMessageId = randomUUID();
    await detectAndEscalate(
      { db, redis, eventBus },
      message({
        guildId,
        userId,
        channelId: "channel-1",
        messageId: secondMessageId,
        createdAt: new Date(now.getTime() + 1000),
      }),
    );
    const thirdMessageId = randomUUID();
    const result = await detectAndEscalate(
      { db, redis, eventBus },
      message({
        guildId,
        userId,
        channelId: "channel-1",
        messageId: thirdMessageId,
        createdAt: new Date(now.getTime() + 2000),
      }),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.bufferedMessageIds).not.toContain(otherChannelMessageId);
    expect(new Set(result[0]?.bufferedMessageIds)).toEqual(new Set([secondMessageId, thirdMessageId]));
  });

  test("ホワイトリスト対象ロールを持つユーザーは連投してもstrikeCountが増加しない", async () => {
    const userId = `u-${randomUUID()}`;
    const roleId = `r-${randomUUID()}`;
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });
    await db.insert(moderationWhitelist).values({ guildId, targetType: "role", targetId: roleId });

    const eventBus = fakeEventBus();
    for (let i = 0; i < 5; i++) {
      await detectAndEscalate({ db, redis, eventBus }, message({ guildId, userId, roleIds: [roleId] }));
    }

    expect(eventBus.published).toEqual([]);
    const rows = await db
      .select()
      .from(moderationEscalationState)
      .where(eq(moderationEscalationState.userId, userId));
    expect(rows).toEqual([]);
  });

  test("同一messageIdの再処理(再配送・ハンドラ再試行)はstrikeCountを進めない", async () => {
    const userId = `u-${randomUUID()}`;
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });

    const eventBus = fakeEventBus();
    const duplicated = message({ guildId, userId });
    const now = new Date();

    // 1, 2件目で閾値未達(strong: messageThreshold=3)、3件目と同一のduplicatedを2回送る
    await detectAndEscalate({ db, redis, eventBus }, message({ guildId, userId, createdAt: now }));
    await detectAndEscalate(
      { db, redis, eventBus },
      message({ guildId, userId, createdAt: new Date(now.getTime() + 1000) }),
    );
    const first = await detectAndEscalate(
      { db, redis, eventBus },
      { ...duplicated, createdAt: new Date(now.getTime() + 2000) },
    );
    const retry = await detectAndEscalate(
      { db, redis, eventBus },
      { ...duplicated, createdAt: new Date(now.getTime() + 2000) },
    );

    expect(first).toHaveLength(1);
    expect(retry).toEqual([]);
    expect(eventBus.published).toHaveLength(1);

    const [row] = await db
      .select()
      .from(moderationEscalationState)
      .where(eq(moderationEscalationState.userId, userId));
    expect(row?.strikeCount).toBe(1);
  });

  test("duplicate_contentのstrikeを既存状態としてseedした後にfloodがヒットすると、strikeCountは合計値でエスカレーション判定される", async () => {
    const eventBus = fakeEventBus();
    await db.insert(moderationThresholds).values([
      { guildId, violationType: "flood", preset: "strong", enabled: true },
    ]);
    // strong: 合計strikeCount>=1でmessageDelete、>=2でtimeout(ESCALATION_STEPS.strong)
    await setEscalationPreset(db, guildId, "strong");

    // duplicate_contentのstrikeCountを1で既存状態としてseedする(このテストではduplicate_content
    // 自体の検知は有効化しない。合計値の算出だけを検証する)。
    const userId = `u-${randomUUID()}`;
    await incrementStrike(db, guildId, userId, "duplicate_content");

    // strong preset: frequency = { windowSeconds: 8, messageThreshold: 3 } のため、
    // 同一ユーザーが3通連投するとflood側がヒットしstrikeCount(flood)が1になる。
    // この時点で合計は duplicate_content(1) + flood(1) = 2 となり、
    // ESCALATION_STEPS.strongでは2以上はtimeoutが対応する。
    let lastOutcomes: Awaited<ReturnType<typeof detectAndEscalate>> = [];
    for (let i = 0; i < 3; i++) {
      lastOutcomes = await detectAndEscalate(
        { db, redis, eventBus },
        { guildId, userId, channelId: "c1", roleIds: [], messageId: randomUUID(), content: `msg-${i}`, createdAt: new Date() },
      );
    }

    const floodOutcome = lastOutcomes.find((o) => o.violationType === "flood");
    expect(floodOutcome?.strikeCount).toBe(2); // duplicate_content(1) + flood(1)の合計
    expect(floodOutcome?.actionType).toBe("timeout"); // ESCALATION_STEPS.strong[2] === "timeout"
  });

  test("エスカレーション強度(preset)を変えると、同じ合計strikeCountでも異なるactionTypeになる", async () => {
    const eventBus = fakeEventBus();
    await db.insert(moderationThresholds).values([
      { guildId, violationType: "flood", preset: "strong", enabled: true },
    ]);
    // weak: ESCALATION_STEPS.weak = { 1: warn, 3: messageDelete, 5: timeout, 7: kick }
    await setEscalationPreset(db, guildId, "weak");

    const userId = `u-${randomUUID()}`;
    let lastOutcomes: Awaited<ReturnType<typeof detectAndEscalate>> = [];
    for (let i = 0; i < 3; i++) {
      lastOutcomes = await detectAndEscalate(
        { db, redis, eventBus },
        { guildId, userId, channelId: "c1", roleIds: [], messageId: randomUUID(), content: `msg-${i}`, createdAt: new Date() },
      );
    }

    const floodOutcome = lastOutcomes.find((o) => o.violationType === "flood");
    expect(floodOutcome?.strikeCount).toBe(1);
    expect(floodOutcome?.actionType).toBe("warn"); // ESCALATION_STEPS.weak[1] === "warn"(strongなら"messageDelete"になり結果が変わる)
  });
});

describe("bufferedMessageIdsInWindow", () => {
  function bufferedMessage(overrides: Partial<BufferedMessage> = {}): BufferedMessage {
    return {
      messageId: randomUUID(),
      channelId: "channel-1",
      content: "msg",
      createdAt: new Date(),
      ...overrides,
    };
  }

  test("同一チャンネル・windowSeconds以内のメッセージのみ残す", () => {
    const now = new Date("2026-01-01T00:00:10.000Z");
    const trigger = message({ guildId: "g", userId: "u", channelId: "channel-1", createdAt: now });
    const inWindow = bufferedMessage({ messageId: "in-window", channelId: "channel-1", createdAt: now });
    const otherChannel = bufferedMessage({
      messageId: "other-channel",
      channelId: "channel-2",
      createdAt: now,
    });
    const tooOld = bufferedMessage({
      messageId: "too-old",
      channelId: "channel-1",
      createdAt: new Date(now.getTime() - 20_000),
    });

    const result = bufferedMessageIdsInWindow([inWindow, otherChannel, tooOld], trigger, 8);

    expect(result).toEqual(["in-window"]);
  });

  test("検知トリガーより後に作成されたメッセージ(配送順の入れ替わり)は含めない", () => {
    const now = new Date("2026-01-01T00:00:10.000Z");
    const trigger = message({ guildId: "g", userId: "u", channelId: "channel-1", createdAt: now });
    const sameTime = bufferedMessage({ messageId: "same-time", channelId: "channel-1", createdAt: now });
    const createdLater = bufferedMessage({
      messageId: "created-later",
      channelId: "channel-1",
      createdAt: new Date(now.getTime() + 5000),
    });

    const result = bufferedMessageIdsInWindow([sameTime, createdLater], trigger, 8);

    expect(result).toEqual(["same-time"]);
  });
});
