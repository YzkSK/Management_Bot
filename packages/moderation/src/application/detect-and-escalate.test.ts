import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  createDb,
  type Db,
  guilds,
  moderationEscalationState,
  moderationNgwords,
  moderationThresholds,
  moderationWhitelist,
} from "@management-bot/db";
import type { ModerationActionRecordedEvent } from "@management-bot/shared";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import {
  bufferedMessageIdsInWindow,
  detectAndEscalate,
  detectAndEscalateOnEdit,
  type IncomingMessage,
  SYSTEM_MODERATOR_ID,
} from "./detect-and-escalate.js";
import { incrementStrike } from "./escalation-state.js";
import { setEscalationPreset } from "./escalation-settings.js";
import type { BufferedMessage } from "./message-buffer.js";
import { createModerationConfigCache } from "./moderation-config-cache.js";
import { addNgword } from "./ngwords.js";
import { addToWhitelist } from "./whitelist.js";

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
  /**
   * configCacheはguild単位でTTLキャッシュするため(#352)、テスト間で使い回すと前のテストの
   * DB設定がキャッシュに残り、afterEachでDB削除しても次のテストに漏れ残る。
   * beforeEachでテストごとに新規生成し、1テスト内の複数呼び出し(deps())では共有する
   * (本番のプロセス起動時に1回だけ生成し複数メッセージで共有する構成を再現するため)。
   */
  let configCache: ReturnType<typeof createModerationConfigCache>;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    ({ db, close } = createDb(databaseUrl));
    await db.insert(guilds).values({ id: guildId, name: "Test Guild" });
  });

  beforeEach(() => {
    configCache = createModerationConfigCache();
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
    await db.delete(moderationNgwords).where(eq(moderationNgwords.guildId, guildId));
    const keys = await redis.keys(`moderation:*:${guildId}:*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  function fakeEventBus() {
    const published: ModerationActionRecordedEvent[] = [];
    return { published, publish: async (event: ModerationActionRecordedEvent) => void published.push(event) };
  }

  /** invite_link以外のテストでは呼ばれない想定のダミー実装(常に自ギルド扱い)。 */
  const resolveInviteGuildId = async (): Promise<string | null> => guildId;

  function deps(
    eventBus: ReturnType<typeof fakeEventBus>,
    overrides: Partial<Parameters<typeof detectAndEscalate>[0]> = {},
  ) {
    return { db, redis, eventBus, resolveInviteGuildId, configCache, ...overrides };
  }

  test("検知種別が何も有効でなければ何も起きない", async () => {
    const eventBus = fakeEventBus();
    const result = await detectAndEscalate(
      deps(eventBus),
      message({ guildId, userId: `u-${randomUUID()}` }),
    );
    expect(result).toEqual({ outcomes: [], lockedMessageIds: [] });
    expect(eventBus.published).toEqual([]);
  });

  test("ホワイトリスト対象ユーザーは連投してもstrikeCountが増加しない", async () => {
    const userId = `u-${randomUUID()}`;
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });
    await db.insert(moderationWhitelist).values({ guildId, targetType: "user", targetId: userId });

    const eventBus = fakeEventBus();
    for (let i = 0; i < 5; i++) {
      await detectAndEscalate(deps(eventBus), message({ guildId, userId }));
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
    // strong preset: windowSeconds=8, messageThreshold=3, 合計strikeCount=1でESCALATION_STEPS.strong[1]=warn
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });
    await setEscalationPreset(db, guildId, "strong");

    const eventBus = fakeEventBus();
    const now = new Date();
    let lastResult: Awaited<ReturnType<typeof detectAndEscalate>> = { outcomes: [], lockedMessageIds: [] };
    for (let i = 0; i < 3; i++) {
      lastResult = await detectAndEscalate(
        deps(eventBus),
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
    expect(eventBus.published).toHaveLength(1);
    expect(eventBus.published[0]).toMatchObject({
      type: "moderation.action.recorded",
      guildId,
      targetUserId: userId,
      moderatorId: SYSTEM_MODERATOR_ID,
      action: "create",
      actionType: "warn",
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
          deps(eventBus),
          message({ guildId, userId, createdAt: new Date(now.getTime() + i * 500) }),
        ),
      );
    }

    const hits = results.filter((r) => r.outcomes.length > 0);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.outcomes).toEqual([
      {
        violationType: "flood",
        strikeCount: 1,
        actionType: "warn",
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

  test("duplicate_content: A→B→Aのように直前1件とは異なる過去投稿の繰り返しも検出する", async () => {
    const userId = `u-${randomUUID()}`;
    // strong preset: duplicateSimilarityThreshold=0.85
    await db.insert(moderationThresholds).values({
      guildId,
      violationType: "duplicate_content",
      preset: "strong",
      enabled: true,
    });
    await setEscalationPreset(db, guildId, "strong");

    const eventBus = fakeEventBus();
    const now = new Date();
    // A → B → A の順で投稿。直前1件(B)との比較だけではAとAの重複を検出できないが、
    // バッファ全体比較であれば3件目(A)が1件目(A)とヒットするはず。
    const first = await detectAndEscalate(
      deps(eventBus),
      message({ guildId, userId, content: "content-A", createdAt: new Date(now.getTime()) }),
    );
    const second = await detectAndEscalate(
      deps(eventBus),
      message({ guildId, userId, content: "completely unrelated message", createdAt: new Date(now.getTime() + 1000) }),
    );
    const third = await detectAndEscalate(
      deps(eventBus),
      message({ guildId, userId, content: "content-A", createdAt: new Date(now.getTime() + 2000) }),
    );

    expect(first.outcomes).toEqual([]);
    expect(second.outcomes).toEqual([]);
    expect(third.outcomes).toEqual([
      {
        violationType: "duplicate_content",
        strikeCount: 1,
        actionType: "warn",
        caseId: expect.any(String),
        bufferedMessageIds: expect.any(Array),
      },
    ]);
  });

  test("duplicate_content: windowSecondsより古い過去投稿とは一致しない(strong preset windowSeconds=8)", async () => {
    const userId = `u-${randomUUID()}`;
    await db.insert(moderationThresholds).values({
      guildId,
      violationType: "duplicate_content",
      preset: "strong",
      enabled: true,
    });
    await setEscalationPreset(db, guildId, "strong");

    const eventBus = fakeEventBus();
    const now = new Date();
    // A@0s → B@7s(TTLをwindowSeconds分延長) → A@14s。BはAから7秒後でwindowSeconds(8秒)以内だが、
    // 3件目(A@14s)は1件目(A@0s)から14秒後でwindowSeconds外のため、一致してはならない。
    await detectAndEscalate(
      deps(eventBus),
      message({ guildId, userId, content: "content-A", createdAt: new Date(now.getTime()) }),
    );
    await detectAndEscalate(
      deps(eventBus),
      message({ guildId, userId, content: "content-B", createdAt: new Date(now.getTime() + 7000) }),
    );
    const third = await detectAndEscalate(
      deps(eventBus),
      message({ guildId, userId, content: "content-A", createdAt: new Date(now.getTime() + 14000) }),
    );

    expect(third.outcomes).toEqual([]);
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
      deps(eventBus),
      message({ guildId, userId, channelId: "channel-other", messageId: otherChannelMessageId, createdAt: now }),
    );
    const secondMessageId = randomUUID();
    await detectAndEscalate(
      deps(eventBus),
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
      deps(eventBus),
      message({
        guildId,
        userId,
        channelId: "channel-1",
        messageId: thirdMessageId,
        createdAt: new Date(now.getTime() + 2000),
      }),
    );

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]?.bufferedMessageIds).not.toContain(otherChannelMessageId);
    expect(new Set(result.outcomes[0]?.bufferedMessageIds)).toEqual(new Set([secondMessageId, thirdMessageId]));
  });

  test("ホワイトリスト対象ロールを持つユーザーは連投してもstrikeCountが増加しない", async () => {
    const userId = `u-${randomUUID()}`;
    const roleId = `r-${randomUUID()}`;
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });
    await db.insert(moderationWhitelist).values({ guildId, targetType: "role", targetId: roleId });

    const eventBus = fakeEventBus();
    for (let i = 0; i < 5; i++) {
      await detectAndEscalate(deps(eventBus), message({ guildId, userId, roleIds: [roleId] }));
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
    await detectAndEscalate(deps(eventBus), message({ guildId, userId, createdAt: now }));
    await detectAndEscalate(
      deps(eventBus),
      message({ guildId, userId, createdAt: new Date(now.getTime() + 1000) }),
    );
    const first = await detectAndEscalate(
      deps(eventBus),
      { ...duplicated, createdAt: new Date(now.getTime() + 2000) },
    );
    const retry = await detectAndEscalate(
      deps(eventBus),
      { ...duplicated, createdAt: new Date(now.getTime() + 2000) },
    );

    expect(first.outcomes).toHaveLength(1);
    expect(retry).toEqual({ outcomes: [], lockedMessageIds: [] });
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
    // strong: 合計strikeCount>=1でwarn、>=2でtimeout(5分。ESCALATION_STEPS.strong、#322)
    await setEscalationPreset(db, guildId, "strong");

    // duplicate_contentのstrikeCountを1で既存状態としてseedする(このテストではduplicate_content
    // 自体の検知は有効化しない。合計値の算出だけを検証する)。
    const userId = `u-${randomUUID()}`;
    await incrementStrike(db, guildId, userId, "duplicate_content");

    // strong preset: frequency = { windowSeconds: 8, messageThreshold: 3 } のため、
    // 同一ユーザーが3通連投するとflood側がヒットしstrikeCount(flood)が1になる。
    // この時点で合計は duplicate_content(1) + flood(1) = 2 となり、
    // ESCALATION_STEPS.strong[2]はtimeout(5分)が対応する。
    let lastOutcomes: Awaited<ReturnType<typeof detectAndEscalate>> = { outcomes: [], lockedMessageIds: [] };
    for (let i = 0; i < 3; i++) {
      lastOutcomes = await detectAndEscalate(
        deps(eventBus),
        { guildId, userId, channelId: "c1", roleIds: [], messageId: randomUUID(), content: `msg-${i}`, createdAt: new Date() },
      );
    }

    const floodOutcome = lastOutcomes.outcomes.find((o) => o.violationType === "flood");
    expect(floodOutcome?.strikeCount).toBe(2); // duplicate_content(1) + flood(1)の合計
    expect(floodOutcome?.actionType).toBe("timeout"); // ESCALATION_STEPS.strong[2].actionType === "timeout"
    expect(floodOutcome?.timeoutMinutes).toBe(5); // ESCALATION_STEPS.strong[2].timeoutMinutes === 5
  });

  test("エスカレーション強度(preset)を変えると、同じ合計strikeCountでも異なるactionTypeになる", async () => {
    const eventBus = fakeEventBus();
    await db.insert(moderationThresholds).values([
      { guildId, violationType: "flood", preset: "strong", enabled: true },
    ]);
    // weak: ESCALATION_STEPS.weak = { 1: warn, 5: timeout, 7: kick }
    await setEscalationPreset(db, guildId, "weak");

    const userId = `u-${randomUUID()}`;
    let lastOutcomes: Awaited<ReturnType<typeof detectAndEscalate>> = { outcomes: [], lockedMessageIds: [] };
    for (let i = 0; i < 3; i++) {
      lastOutcomes = await detectAndEscalate(
        deps(eventBus),
        { guildId, userId, channelId: "c1", roleIds: [], messageId: randomUUID(), content: `msg-${i}`, createdAt: new Date() },
      );
    }

    const floodOutcome = lastOutcomes.outcomes.find((o) => o.violationType === "flood");
    expect(floodOutcome?.strikeCount).toBe(1);
    expect(floodOutcome?.actionType).toBe("warn"); // ESCALATION_STEPS.weak[1] === "warn"
  });

  test("登録済みNGワードに一致するメッセージはngwordとして検知され、削除対象はそのメッセージ自身のみ", async () => {
    const userId = `u-${randomUUID()}`;
    await db.insert(moderationThresholds).values({ guildId, violationType: "ngword", preset: "medium", enabled: true });
    await addNgword(db, guildId, "exact", "banned-word");

    const eventBus = fakeEventBus();
    const messageId = randomUUID();
    const result = await detectAndEscalate(
      deps(eventBus),
      message({ guildId, userId, messageId, content: "banned-word" }),
    );

    expect(result.outcomes).toEqual([
      {
        violationType: "ngword",
        strikeCount: 1,
        actionType: "warn",
        caseId: expect.any(String),
        bufferedMessageIds: [messageId],
      },
    ]);
  });

  test("strikeロック中(10秒以内)の連続NGワード投稿は、2件目以降もstrikeは進まないがlockedMessageIdsに削除対象として含まれる(#338)", async () => {
    const userId = `u-${randomUUID()}`;
    await db.insert(moderationThresholds).values({ guildId, violationType: "ngword", preset: "medium", enabled: true });
    await addNgword(db, guildId, "exact", "banned-word");

    const eventBus = fakeEventBus();
    const now = new Date();
    const firstMessageId = randomUUID();
    const secondMessageId = randomUUID();
    const first = await detectAndEscalate(
      deps(eventBus),
      message({ guildId, userId, messageId: firstMessageId, content: "banned-word", createdAt: now }),
    );
    const second = await detectAndEscalate(
      deps(eventBus),
      message({
        guildId,
        userId,
        messageId: secondMessageId,
        content: "banned-word",
        createdAt: new Date(now.getTime() + 1000),
      }),
    );

    expect(first.outcomes).toHaveLength(1);
    expect(first.lockedMessageIds).toEqual([]);
    expect(second.outcomes).toEqual([]);
    expect(second.lockedMessageIds).toEqual([secondMessageId]);
    expect(eventBus.published).toHaveLength(1);

    const [row] = await db
      .select()
      .from(moderationEscalationState)
      .where(eq(moderationEscalationState.userId, userId));
    expect(row?.strikeCount).toBe(1);
  });

  test("NGワードに一致しないメッセージはngwordとして検知されない", async () => {
    const userId = `u-${randomUUID()}`;
    await db.insert(moderationThresholds).values({ guildId, violationType: "ngword", preset: "medium", enabled: true });
    await addNgword(db, guildId, "exact", "banned-word");

    const eventBus = fakeEventBus();
    const result = await detectAndEscalate(
      deps(eventBus),
      message({ guildId, userId, content: "clean message" }),
    );

    expect(result.outcomes).toEqual([]);
  });

  test("1メッセージ内のメンション数がmedium presetの単発閾値(6)以上ならmention_spamとして検知される", async () => {
    const userId = `u-${randomUUID()}`;
    await db
      .insert(moderationThresholds)
      .values({ guildId, violationType: "mention_spam", preset: "medium", enabled: true });

    const eventBus = fakeEventBus();
    const mentions = Array.from({ length: 6 }, (_, i) => `<@${i}>`).join(" ");
    const messageId = randomUUID();
    const result = await detectAndEscalate(
      deps(eventBus),
      message({ guildId, userId, messageId, content: mentions }),
    );

    expect(result.outcomes).toEqual([
      {
        violationType: "mention_spam",
        strikeCount: 1,
        actionType: "warn",
        caseId: expect.any(String),
        bufferedMessageIds: [messageId],
      },
    ]);
  });

  test("strikeロック中(cumulative.windowSeconds以内)の連続メンションスパム投稿は、2件目以降もstrikeは進まないがlockedMessageIdsに削除対象として含まれる(#338)", async () => {
    const userId = `u-${randomUUID()}`;
    await db
      .insert(moderationThresholds)
      .values({ guildId, violationType: "mention_spam", preset: "medium", enabled: true });

    const eventBus = fakeEventBus();
    const mentions = Array.from({ length: 6 }, (_, i) => `<@${i}>`).join(" ");
    const now = new Date();
    const firstMessageId = randomUUID();
    const secondMessageId = randomUUID();
    const first = await detectAndEscalate(
      deps(eventBus),
      message({ guildId, userId, messageId: firstMessageId, content: mentions, createdAt: now }),
    );
    const second = await detectAndEscalate(
      deps(eventBus),
      message({
        guildId,
        userId,
        messageId: secondMessageId,
        content: mentions,
        createdAt: new Date(now.getTime() + 1000),
      }),
    );

    expect(first.outcomes).toHaveLength(1);
    expect(first.lockedMessageIds).toEqual([]);
    expect(second.outcomes).toEqual([]);
    expect(second.lockedMessageIds).toEqual([secondMessageId]);
    expect(eventBus.published).toHaveLength(1);

    const [row] = await db
      .select()
      .from(moderationEscalationState)
      .where(eq(moderationEscalationState.userId, userId));
    expect(row?.strikeCount).toBe(1);
  });

  test("invite_linkが有効でもメンション投稿はmention_spamとして誤検知されない(Codexレビュー指摘の回帰テスト)", async () => {
    const userId = `u-${randomUUID()}`;
    await db
      .insert(moderationThresholds)
      .values({ guildId, violationType: "invite_link", preset: "medium", enabled: true });

    const eventBus = fakeEventBus();
    const mentions = Array.from({ length: 6 }, (_, i) => `<@${i}>`).join(" ");
    const result = await detectAndEscalate(deps(eventBus), message({ guildId, userId, content: mentions }));

    expect(result.outcomes).toEqual([]);
  });

  describe("invite_link検知", () => {
    test("自ギルドへの招待リンクは検知されない", async () => {
      const userId = `u-${randomUUID()}`;
      await db
        .insert(moderationThresholds)
        .values({ guildId, violationType: "invite_link", preset: "medium", enabled: true });

      const eventBus = fakeEventBus();
      const result = await detectAndEscalate(
        deps(eventBus, { resolveInviteGuildId: async () => guildId }),
        message({ guildId, userId, content: "join us: discord.gg/own-guild-code" }),
      );

      expect(result.outcomes).toEqual([]);
    });

    test("他ギルドへの招待リンクは検知される", async () => {
      const userId = `u-${randomUUID()}`;
      await db
        .insert(moderationThresholds)
        .values({ guildId, violationType: "invite_link", preset: "medium", enabled: true });

      const eventBus = fakeEventBus();
      const result = await detectAndEscalate(
        deps(eventBus, { resolveInviteGuildId: async () => "other-guild-id" }),
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
    });

    test("strikeロック中(10秒以内)の連続招待リンク投稿は、2件目以降もstrikeは進まないがlockedMessageIdsに削除対象として含まれる(#338)", async () => {
      const userId = `u-${randomUUID()}`;
      await db
        .insert(moderationThresholds)
        .values({ guildId, violationType: "invite_link", preset: "medium", enabled: true });

      const eventBus = fakeEventBus();
      const now = new Date();
      const firstMessageId = randomUUID();
      const secondMessageId = randomUUID();
      const first = await detectAndEscalate(
        deps(eventBus, { resolveInviteGuildId: async () => "other-guild-id" }),
        message({
          guildId,
          userId,
          messageId: firstMessageId,
          content: "join us: discord.gg/other-guild-code",
          createdAt: now,
        }),
      );
      const second = await detectAndEscalate(
        deps(eventBus, { resolveInviteGuildId: async () => "other-guild-id" }),
        message({
          guildId,
          userId,
          messageId: secondMessageId,
          content: "join us: discord.gg/other-guild-code",
          createdAt: new Date(now.getTime() + 1000),
        }),
      );

      expect(first.outcomes).toHaveLength(1);
      expect(first.lockedMessageIds).toEqual([]);
      expect(second.outcomes).toEqual([]);
      expect(second.lockedMessageIds).toEqual([secondMessageId]);
      expect(eventBus.published).toHaveLength(1);

      const [row] = await db
        .select()
        .from(moderationEscalationState)
        .where(eq(moderationEscalationState.userId, userId));
      expect(row?.strikeCount).toBe(1);
    });

    test("招待コード解決失敗時は安全側(検知扱い)に倒れる", async () => {
      const userId = `u-${randomUUID()}`;
      await db
        .insert(moderationThresholds)
        .values({ guildId, violationType: "invite_link", preset: "medium", enabled: true });

      const eventBus = fakeEventBus();
      const result = await detectAndEscalate(
        deps(eventBus, { resolveInviteGuildId: async () => null }),
        message({ guildId, userId, content: "join us: discord.gg/unresolvable-code" }),
      );

      expect(result.outcomes).toHaveLength(1);
      expect(result.outcomes[0]?.violationType).toBe("invite_link");
    });

    test("招待リンクを含まないメッセージは検知されない", async () => {
      const userId = `u-${randomUUID()}`;
      await db
        .insert(moderationThresholds)
        .values({ guildId, violationType: "invite_link", preset: "medium", enabled: true });

      const eventBus = fakeEventBus();
      const result = await detectAndEscalate(
        deps(eventBus, { resolveInviteGuildId: async () => "other-guild-id" }),
        message({ guildId, userId, content: "hello world" }),
      );

      expect(result.outcomes).toEqual([]);
    });

    test("他ギルドの招待が見つかった時点で以降のresolveInviteGuildId呼び出しを打ち切る(Codexレビュー指摘の回帰テスト: レート制限消費対策)", async () => {
      const userId = `u-${randomUUID()}`;
      await db
        .insert(moderationThresholds)
        .values({ guildId, violationType: "invite_link", preset: "medium", enabled: true });

      const resolvedCodes: string[] = [];
      const eventBus = fakeEventBus();
      const result = await detectAndEscalate(
        deps(eventBus, {
          resolveInviteGuildId: async (code) => {
            resolvedCodes.push(code);
            return "other-guild-id";
          },
        }),
        message({
          guildId,
          userId,
          content: "discord.gg/first-code discord.gg/second-code discord.gg/third-code",
        }),
      );

      expect(result.outcomes).toHaveLength(1);
      expect(resolvedCodes).toEqual(["first-code"]);
    });

    test("全て自ギルドの招待なら全件resolveInviteGuildIdを呼び出したうえで検知されない", async () => {
      const userId = `u-${randomUUID()}`;
      await db
        .insert(moderationThresholds)
        .values({ guildId, violationType: "invite_link", preset: "medium", enabled: true });

      const resolvedCodes: string[] = [];
      const eventBus = fakeEventBus();
      const result = await detectAndEscalate(
        deps(eventBus, {
          resolveInviteGuildId: async (code) => {
            resolvedCodes.push(code);
            return guildId;
          },
        }),
        message({ guildId, userId, content: "discord.gg/first-code discord.gg/second-code" }),
      );

      expect(result.outcomes).toEqual([]);
      expect(resolvedCodes).toEqual(["first-code", "second-code"]);
    });
  });

  test("短時間内の累積メンション数がmedium presetの累積閾値(10)以上ならmention_spamとして検知される", async () => {
    const userId = `u-${randomUUID()}`;
    await db
      .insert(moderationThresholds)
      .values({ guildId, violationType: "mention_spam", preset: "medium", enabled: true });

    const eventBus = fakeEventBus();
    const now = new Date();
    // medium: cumulative.windowSeconds=10, mentionThreshold=10。各メッセージ4件ずつメンションし、
    // 3通目で合計12件に達して累積ヒットする(単発閾値6は超えない)。
    let lastResult: Awaited<ReturnType<typeof detectAndEscalate>> = { outcomes: [], lockedMessageIds: [] };
    for (let i = 0; i < 3; i++) {
      lastResult = await detectAndEscalate(
        deps(eventBus),
        message({
          guildId,
          userId,
          content: "<@1> <@2> <@3> <@4>",
          createdAt: new Date(now.getTime() + i * 1000),
        }),
      );
    }

    expect(lastResult.outcomes).toHaveLength(1);
    expect(lastResult.outcomes[0]?.violationType).toBe("mention_spam");
  });

  test("windowSecondsより前の古いメンションは累積判定に含まれない(Codexレビュー指摘の回帰テスト)", async () => {
    const userId = `u-${randomUUID()}`;
    await db
      .insert(moderationThresholds)
      .values({ guildId, violationType: "mention_spam", preset: "medium", enabled: true });

    const eventBus = fakeEventBus();
    const now = new Date();
    // medium: cumulative.windowSeconds=10, mentionThreshold=10。
    // 1通目(4件)はwindowSeconds(10秒)より前に古くなるよう20秒前に送り、
    // 2通目(4件)・3通目(4件)は直近1秒間隔で送る。時刻フィルタが正しく効いていれば
    // 直近2通の合計8件はmentionThreshold(10)未満のためヒットしない
    // (フィルタなしで全件合算すると12件になりヒットしてしまう、というバグの回帰確認)。
    await detectAndEscalate(
      deps(eventBus),
      message({ guildId, userId, content: "<@1> <@2> <@3> <@4>", createdAt: new Date(now.getTime() - 20_000) }),
    );
    let lastResult: Awaited<ReturnType<typeof detectAndEscalate>> = { outcomes: [], lockedMessageIds: [] };
    for (let i = 0; i < 2; i++) {
      lastResult = await detectAndEscalate(
        deps(eventBus),
        message({ guildId, userId, content: "<@1> <@2> <@3> <@4>", createdAt: new Date(now.getTime() + i * 1000) }),
      );
    }

    expect(lastResult.outcomes).toEqual([]);
  });

  describe("link_spam検知(#369)", () => {
    test("外部招待+メンション併用のスコア合計がstrong presetの閾値(50)以上ならlink_spamとして検知される", async () => {
      const userId = `u-${randomUUID()}`;
      await db
        .insert(moderationThresholds)
        .values({ guildId, violationType: "link_spam", preset: "strong", enabled: true });

      const eventBus = fakeEventBus();
      // 外部招待50 + メンション併用20 = 70点 >= strong閾値50
      const result = await detectAndEscalate(
        deps(eventBus, { resolveInviteGuildId: async () => "other-guild-id" }),
        message({ guildId, userId, content: "<@123> discord.gg/other-guild-code" }),
      );

      expect(result.outcomes).toHaveLength(1);
      expect(result.outcomes[0]?.violationType).toBe("link_spam");
    });

    test("スコアが閾値未満ならlink_spamとして検知されない", async () => {
      const userId = `u-${randomUUID()}`;
      await db
        .insert(moderationThresholds)
        .values({ guildId, violationType: "link_spam", preset: "strong", enabled: true });

      const eventBus = fakeEventBus();
      // 宣伝語句15点のみ < strong閾値50
      const result = await detectAndEscalate(
        deps(eventBus),
        message({ guildId, userId, content: "サーバー宣伝します" }),
      );

      expect(result.outcomes).toEqual([]);
    });

    test("参加直後(24時間以内)の投稿はjoinedAtのスコア加点が反映される", async () => {
      const userId = `u-${randomUUID()}`;
      await db
        .insert(moderationThresholds)
        .values({ guildId, violationType: "link_spam", preset: "strong", enabled: true });

      const eventBus = fakeEventBus();
      const now = new Date();
      // 外部招待50 + 参加24時間以内20 = 70点 >= strong閾値50
      const result = await detectAndEscalate(
        deps(eventBus, { resolveInviteGuildId: async () => "other-guild-id" }),
        message({
          guildId,
          userId,
          content: "discord.gg/other-guild-code",
          createdAt: now,
          joinedAt: new Date(now.getTime() - 60 * 60 * 1000),
        }),
      );

      expect(result.outcomes).toHaveLength(1);
      expect(result.outcomes[0]?.violationType).toBe("link_spam");
    });
  });

  describe("detectAndEscalateOnEdit(#362-7.1)", () => {
    test("編集後の内容がNGワードに一致すればngwordとして検知される", async () => {
      const userId = `u-${randomUUID()}`;
      await db.insert(moderationThresholds).values({ guildId, violationType: "ngword", preset: "medium", enabled: true });
      await addNgword(db, guildId, "exact", "banned-word");

      const eventBus = fakeEventBus();
      const messageId = randomUUID();
      const result = await detectAndEscalateOnEdit(
        deps(eventBus),
        message({ guildId, userId, messageId, content: "banned-word" }),
      );

      expect(result.outcomes).toEqual([
        {
          violationType: "ngword",
          strikeCount: 1,
          actionType: "warn",
          caseId: expect.any(String),
          bufferedMessageIds: [messageId],
        },
      ]);
    });

    test("編集後の内容が他ギルドの招待リンクを含めばinvite_linkとして検知される", async () => {
      const userId = `u-${randomUUID()}`;
      await db
        .insert(moderationThresholds)
        .values({ guildId, violationType: "invite_link", preset: "medium", enabled: true });

      const eventBus = fakeEventBus();
      const result = await detectAndEscalateOnEdit(
        deps(eventBus, { resolveInviteGuildId: async () => "other-guild-id" }),
        message({ guildId, userId, content: "discord.gg/edited-in-code" }),
      );

      expect(result.outcomes).toHaveLength(1);
      expect(result.outcomes[0]?.violationType).toBe("invite_link");
    });

    test("flood/duplicate_content/mention_spamはthresholdが有効でも対象外", async () => {
      const userId = `u-${randomUUID()}`;
      await db.insert(moderationThresholds).values([
        { guildId, violationType: "flood", preset: "medium", enabled: true },
        { guildId, violationType: "duplicate_content", preset: "medium", enabled: true },
        { guildId, violationType: "mention_spam", preset: "medium", enabled: true },
      ]);

      const eventBus = fakeEventBus();
      const result = await detectAndEscalateOnEdit(
        deps(eventBus),
        message({ guildId, userId, content: "<@1> <@2> <@3> <@4> <@5> <@6> <@7>" }),
      );

      expect(result).toEqual({ outcomes: [], lockedMessageIds: [] });
    });

    test("ホワイトリスト対象ユーザーの編集は検知されない", async () => {
      const userId = `u-${randomUUID()}`;
      await db.insert(moderationThresholds).values({ guildId, violationType: "ngword", preset: "medium", enabled: true });
      await addNgword(db, guildId, "exact", "banned-word");
      await addToWhitelist(db, { guildId, targetType: "user", targetId: userId });

      const eventBus = fakeEventBus();
      const result = await detectAndEscalateOnEdit(
        deps(eventBus),
        message({ guildId, userId, content: "banned-word" }),
      );

      expect(result).toEqual({ outcomes: [], lockedMessageIds: [] });
    });

    test("messageCreateで既にclaimAndPushMessage済みのmessageIdでも編集時は再度検知される(processedKeyを使わない)", async () => {
      const userId = `u-${randomUUID()}`;
      await db.insert(moderationThresholds).values({ guildId, violationType: "ngword", preset: "medium", enabled: true });
      await addNgword(db, guildId, "exact", "banned-word");

      const eventBus = fakeEventBus();
      const messageId = randomUUID();
      // 投稿時点では無害な内容でcreateを通す(同一messageIdでprocessedKeyがマークされる)。
      const created = await detectAndEscalate(deps(eventBus), message({ guildId, userId, messageId, content: "hello" }));
      expect(created.outcomes).toEqual([]);

      // 編集で禁止ワードを仕込んだ場合、processedKeyでブロックされず検知できることを確認する。
      const edited = await detectAndEscalateOnEdit(
        deps(eventBus),
        message({ guildId, userId, messageId, content: "banned-word" }),
      );
      expect(edited.outcomes).toHaveLength(1);
      expect(edited.outcomes[0]?.violationType).toBe("ngword");
    });
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
