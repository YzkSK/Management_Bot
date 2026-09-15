import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, type Db, guilds, moderationEscalationState, moderationThresholds } from "@management-bot/db";
import type { ModerationActionRecordedEvent } from "@management-bot/shared";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import type { Message } from "discord.js";
import { setEscalationPreset } from "../application/escalation-settings.js";
import { handleMessageCreate } from "./handle-message-create.js";

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

function fakeMessage(overrides: {
  guildId: string;
  userId: string;
  content: string;
  channelId?: string;
  bot?: boolean;
  hasGuild?: boolean;
  hasMember?: boolean;
}) {
  const deleteFn = mock(() => Promise.resolve());
  const bulkDelete = mock(() => Promise.resolve());
  const timeout = mock(() => Promise.resolve());
  const kick = mock(() => Promise.resolve());
  const ban = mock(() => Promise.resolve());
  return {
    author: { id: overrides.userId, bot: overrides.bot ?? false },
    guild: overrides.hasGuild === false ? null : { id: overrides.guildId },
    member: overrides.hasMember === false ? null : { roles: { cache: new Map() }, timeout, kick, ban },
    id: randomUUID(),
    channelId: overrides.channelId ?? "channel-1",
    content: overrides.content,
    createdAt: new Date(),
    delete: deleteFn,
    deleteFn,
    channel: { bulkDelete },
    bulkDelete,
    timeout,
    kick,
    ban,
  };
}

describe.skipIf(!(await isRedisAvailable()))("handleMessageCreate", () => {
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
    await db.delete(moderationEscalationState).where(eq(moderationEscalationState.guildId, guildId));
    const keys = await redis.keys(`moderation:*:${guildId}:*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  function fakeEventBus() {
    const published: ModerationActionRecordedEvent[] = [];
    return { published, publish: async (event: ModerationActionRecordedEvent) => void published.push(event) };
  }

  test("botのメッセージは無視する", async () => {
    const eventBus = fakeEventBus();
    const message = fakeMessage({ guildId, userId: `u-${randomUUID()}`, content: "hi", bot: true });
    await handleMessageCreate({ db, redis, eventBus }, message as unknown as Message);
    expect(eventBus.published).toEqual([]);
  });

  test("guild/memberがないメッセージ(DM等)は無視する", async () => {
    const eventBus = fakeEventBus();
    const message = fakeMessage({ guildId, userId: `u-${randomUUID()}`, content: "hi", hasGuild: false });
    await handleMessageCreate({ db, redis, eventBus }, message as unknown as Message);
    expect(eventBus.published).toEqual([]);
  });

  test("連投でstrong presetの閾値に達するとmessageDeleteが実行される", async () => {
    const userId = `u-${randomUUID()}`;
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });
    // エスカレーション強度もstrongにしないと合計strikeCount=1がESCALATION_STEPS.medium[1]=warnになり
    // messageDeleteが実行されない(統一ストライクカウンター、#311)。
    await setEscalationPreset(db, guildId, "strong");

    const eventBus = fakeEventBus();
    let last: ReturnType<typeof fakeMessage> | undefined;
    for (let i = 0; i < 3; i++) {
      last = fakeMessage({ guildId, userId, content: `msg-${i}` });
      await handleMessageCreate({ db, redis, eventBus }, last as unknown as Message);
    }

    expect(last?.bulkDelete).toHaveBeenCalledTimes(1);
    expect(eventBus.published).toHaveLength(1);
  });

  test("flood/duplicate_contentが同時にヒットしても、それぞれ同一バースト中は1回しかstrikeが進まない", async () => {
    const userId = `u-${randomUUID()}`;
    // flood: strong(windowSeconds=8, messageThreshold=3) / duplicate_content: strong(閾値0.85, strike1でmessageDelete)
    await db.insert(moderationThresholds).values([
      { guildId, violationType: "flood", preset: "strong", enabled: true },
      { guildId, violationType: "duplicate_content", preset: "strong", enabled: true },
    ]);
    await setEscalationPreset(db, guildId, "strong");

    const eventBus = fakeEventBus();
    const content = "spam spam spam";
    let last: ReturnType<typeof fakeMessage> | undefined;
    for (let i = 0; i < 3; i++) {
      last = fakeMessage({ guildId, userId, content });
      await handleMessageCreate({ db, redis, eventBus }, last as unknown as Message);
    }

    // 2件目: duplicate_content(合計strikeCount=1)がヒットしESCALATION_STEPS.strong[1]=messageDelete。
    // 以降8秒間はduplicate_contentのロックを保持。
    // 3件目: flood(合計strikeCount=2、duplicate_content分と合わせた統一カウンター、#311)がヒットし
    // ESCALATION_STEPS.strong[2]=timeoutに到達する。duplicate_contentも閾値には達し続けるが、
    // 同一バースト中(ロック保持中)のためstrikeは進まずイベントもpublishされない。
    // timeout実行時もdeleteBufferedMessagesSafely経由でバッファの削除は必ず行われる。
    expect(eventBus.published).toHaveLength(2);
    expect(last?.bulkDelete).toHaveBeenCalledTimes(1);
    expect(last?.timeout).toHaveBeenCalledTimes(1);
  });

  test("同一メッセージでflood(timeout)とduplicate_content(kick)が同時にヒットした場合、処罰はより重い方に集約されるがメッセージ削除は必ず実行される", async () => {
    const userId = `u-${randomUUID()}`;
    // flood: strong(windowSeconds=8, messageThreshold=3) / duplicate_content: strong(閾値0.85)
    await db.insert(moderationThresholds).values([
      { guildId, violationType: "flood", preset: "strong", enabled: true },
      { guildId, violationType: "duplicate_content", preset: "strong", enabled: true },
    ]);
    await setEscalationPreset(db, guildId, "strong");
    // duplicate_contentのstrikeCountを1でseedしておく(統一ストライクカウンター、#311)。
    // 3件目で新バーストとしてflood/duplicate_contentが同時ヒットする際、
    // 処理順(スレッショルド登録順: flood→duplicate_content)で合計strikeCountが積み上がる:
    //   flood加算後の合計 = flood(1) + duplicate_content(1,seed) = 2 → ESCALATION_STEPS.strong[2]=timeout
    //   duplicate_content加算後の合計 = flood(1) + duplicate_content(2) = 3 → ESCALATION_STEPS.strong[3]=kick
    await db.insert(moderationEscalationState).values({
      guildId,
      userId,
      violationType: "duplicate_content",
      strikeCount: 1,
    });

    const eventBus = fakeEventBus();
    let last: ReturnType<typeof fakeMessage> | undefined;
    for (const content of ["A", "B", "B"]) {
      last = fakeMessage({ guildId, userId, content });
      await handleMessageCreate({ db, redis, eventBus }, last as unknown as Message);
    }

    // 3件目: floodがtimeout(合計2)、duplicate_content("B"が2連続)がkick(合計3)に到達。
    // moderation.action.recordedは両方publishされるが、Discord側の処罰実行はより重いkickに
    // 集約される(mostSevere)。messageDelete相当の削除は処罰の集約とは関係なく実行される
    // (連投メッセージが削除されずに残らないようにするため)。
    expect(eventBus.published).toHaveLength(2);
    expect(last?.kick).toHaveBeenCalledTimes(1);
    expect(last?.timeout).not.toHaveBeenCalled();
    expect(last?.bulkDelete).toHaveBeenCalledTimes(1);
  });
});
