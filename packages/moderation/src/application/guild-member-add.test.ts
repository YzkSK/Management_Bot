import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  createDb,
  type Db,
  guilds,
  moderationEscalationState,
  moderationRaidState,
  moderationThresholds,
  moderationWhitelist,
} from "@management-bot/db";
import type { ModerationActionRecordedEvent } from "@management-bot/shared";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { handleGuildMemberAdd, type IncomingGuildMember } from "./guild-member-add.js";
import { createModerationConfigCache } from "./moderation-config-cache.js";

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

function member(overrides: Partial<IncomingGuildMember> & Pick<IncomingGuildMember, "guildId" | "userId">): IncomingGuildMember {
  const now = new Date();
  return {
    roleIds: [],
    accountCreatedAt: now,
    joinedAt: now,
    ...overrides,
  };
}

describe.skipIf(!(await isRedisAvailable()))("handleGuildMemberAdd", () => {
  let db: Db;
  let close: () => Promise<void>;
  const redis = new Redis(REDIS_URL);
  const guildId = `test-guild-${randomUUID()}`;
  /**
   * configCacheはguild単位でTTLキャッシュするため(#352)、テスト間で使い回すと前のテストの
   * DB設定がキャッシュに残り、afterEachでDB削除しても次のテストに漏れ残る。
   * beforeEachでテストごとに新規生成し、1テスト内の複数呼び出し(deps())では共有する。
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
    await db.delete(moderationRaidState).where(eq(moderationRaidState.guildId, guildId));
    const keys = [
      ...(await redis.keys(`moderation:raid:${guildId}`)),
      ...(await redis.keys(`moderation:raid-lock:${guildId}`)),
    ];
    if (keys.length > 0) await redis.del(...keys);
  });

  function fakeEventBus() {
    const published: ModerationActionRecordedEvent[] = [];
    return { published, publish: async (event: ModerationActionRecordedEvent) => void published.push(event) };
  }

  function deps(eventBus: ReturnType<typeof fakeEventBus>) {
    return { db, redis, eventBus, configCache };
  }

  test("raid/new_account_guardのどちらも無効なら何も起きない", async () => {
    const eventBus = fakeEventBus();
    const result = await handleGuildMemberAdd(
      deps(eventBus),
      member({ guildId, userId: `u-${randomUUID()}` }),
    );
    expect(result).toEqual({ raidHit: null, newAccountGuardOutcome: null });
    expect(eventBus.published).toEqual([]);
  });

  test("ホワイトリスト対象ユーザーはraid/new_account_guard両方の判定対象から除外される", async () => {
    const userId = `u-${randomUUID()}`;
    await db.insert(moderationThresholds).values({ guildId, violationType: "raid", preset: "strong", enabled: true });
    await db
      .insert(moderationThresholds)
      .values({ guildId, violationType: "new_account_guard", preset: "strong", enabled: true });
    await db.insert(moderationWhitelist).values({ guildId, targetType: "user", targetId: userId });

    const eventBus = fakeEventBus();
    const now = new Date();
    const result = await handleGuildMemberAdd(
      deps(eventBus),
      member({ guildId, userId, accountCreatedAt: now, joinedAt: now }),
    );

    expect(result).toEqual({ raidHit: null, newAccountGuardOutcome: null });
    expect(eventBus.published).toEqual([]);
  });

  test("raid: ウィンドウ内の入室者数がstrong presetの閾値(6人)に達すると一括アクションがpublishされ、moderation_raid_stateが更新される", async () => {
    await db.insert(moderationThresholds).values({ guildId, violationType: "raid", preset: "strong", enabled: true });
    const eventBus = fakeEventBus();
    const now = new Date();
    const userIds = Array.from({ length: 6 }, () => `u-${randomUUID()}`);

    let lastResult;
    for (const userId of userIds) {
      lastResult = await handleGuildMemberAdd(
        deps(eventBus),
        member({ guildId, userId, accountCreatedAt: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000), joinedAt: now }),
      );
    }

    expect(lastResult?.raidHit).not.toBeNull();
    // pushRaidEntryはLPUSHでバッファ先頭に積むため、targetUserIdsは新しい順(入室と逆順)になる。
    expect(lastResult?.raidHit?.targetUserIds).toEqual([...userIds].reverse());
    expect(lastResult?.raidHit?.severity).toBe("normal");
    expect(eventBus.published).toHaveLength(6);
    expect(new Set(eventBus.published.map((e) => e.caseId)).size).toBe(1);
    for (const event of eventBus.published) {
      expect(event.actionType).toBe("timeout");
    }

    const [raidState] = await db.select().from(moderationRaidState).where(eq(moderationRaidState.guildId, guildId));
    expect(raidState?.incidentCount).toBe(1);
  });

  test("raid: 閾値到達後も入室が続く間は、windowSeconds以内なら新規インシデントとして再検知しない(同一バースト中の重複timeout防止)", async () => {
    await db.insert(moderationThresholds).values({ guildId, violationType: "raid", preset: "strong", enabled: true });
    const eventBus = fakeEventBus();
    const now = new Date();
    const oldAccountCreatedAt = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    // strong presetの閾値は6人。6人目でヒットし、7〜8人目でも同一バースト(windowSeconds以内)の
    // ままなら新規インシデントとして扱わずnullを返す。
    for (let i = 0; i < 6; i++) {
      await handleGuildMemberAdd(
        deps(eventBus),
        member({ guildId, userId: `u-${randomUUID()}`, accountCreatedAt: oldAccountCreatedAt, joinedAt: now }),
      );
    }
    expect(eventBus.published).toHaveLength(6);

    const seventh = await handleGuildMemberAdd(
      deps(eventBus),
      member({ guildId, userId: `u-${randomUUID()}`, accountCreatedAt: oldAccountCreatedAt, joinedAt: now }),
    );
    const eighth = await handleGuildMemberAdd(
      deps(eventBus),
      member({ guildId, userId: `u-${randomUUID()}`, accountCreatedAt: oldAccountCreatedAt, joinedAt: now }),
    );

    expect(seventh.raidHit).toBeNull();
    expect(eighth.raidHit).toBeNull();
    expect(eventBus.published).toHaveLength(6);

    const [raidState] = await db.select().from(moderationRaidState).where(eq(moderationRaidState.guildId, guildId));
    expect(raidState?.incidentCount).toBe(1);
  });

  test("raid: 過去にこのguildでレイドを検知済み(incidentCount>=1)なら、新規アカウント比率に関わらずseverity=highになる", async () => {
    await db.insert(moderationThresholds).values({ guildId, violationType: "raid", preset: "strong", enabled: true });
    // incidentCountを1で事前seedし、「過去に1回検知済み」の状態を再現する。
    await db.insert(moderationRaidState).values({ guildId, incidentCount: 1, lastRaidAt: new Date() });

    const eventBus = fakeEventBus();
    const now = new Date();
    // 新規アカウント比率0%(全員十分古いアカウント)でもrepeat incidentによりhighになることを確認する。
    const oldAccountCreatedAt = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const userIds = Array.from({ length: 6 }, () => `u-${randomUUID()}`);

    let lastResult;
    for (const userId of userIds) {
      lastResult = await handleGuildMemberAdd(
        deps(eventBus),
        member({ guildId, userId, accountCreatedAt: oldAccountCreatedAt, joinedAt: now }),
      );
    }

    expect(lastResult?.raidHit?.severity).toBe("high");
    expect(lastResult?.raidHit?.timeoutMinutes).toBe(1440);

    const [raidState] = await db.select().from(moderationRaidState).where(eq(moderationRaidState.guildId, guildId));
    expect(raidState?.incidentCount).toBe(2);
  });

  test("raid: 新規アカウント比率が閾値以上ならseverity=highでtimeoutMinutesが長くなる", async () => {
    await db.insert(moderationThresholds).values({ guildId, violationType: "raid", preset: "strong", enabled: true });
    const eventBus = fakeEventBus();
    const now = new Date();
    // strong preset: newAccountRatioThreshold=0.4, newAccountMaxAgeDays=14
    const userIds = Array.from({ length: 6 }, () => `u-${randomUUID()}`);

    let lastResult;
    for (const userId of userIds) {
      lastResult = await handleGuildMemberAdd(
        deps(eventBus),
        member({ guildId, userId, accountCreatedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000), joinedAt: now }),
      );
    }

    expect(lastResult?.raidHit?.severity).toBe("high");
    expect(lastResult?.raidHit?.timeoutMinutes).toBe(1440);
  });

  test("raid: ホワイトリスト対象の入室はバッファに積まれず、人数カウントから除外される", async () => {
    await db.insert(moderationThresholds).values({ guildId, violationType: "raid", preset: "strong", enabled: true });
    const whitelistedUserId = `u-${randomUUID()}`;
    await db.insert(moderationWhitelist).values({ guildId, targetType: "user", targetId: whitelistedUserId });

    const eventBus = fakeEventBus();
    const now = new Date();

    await handleGuildMemberAdd(deps(eventBus), member({ guildId, userId: whitelistedUserId, joinedAt: now }));

    const userIds = Array.from({ length: 5 }, () => `u-${randomUUID()}`);
    let lastResult;
    for (const userId of userIds) {
      lastResult = await handleGuildMemberAdd(
        deps(eventBus),
        member({ guildId, userId, accountCreatedAt: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000), joinedAt: now }),
      );
    }

    // strong presetの閾値は6人。ホワイトリスト対象1人+通常5人=6人分入室したが、
    // ホワイトリスト対象はバッファに積まれないため実際のカウントは5人でヒットしない。
    expect(lastResult?.raidHit).toBeNull();
  });

  test("new_account_guard: 作成間もないアカウントの入室でstrikeが加算されイベントがpublishされる", async () => {
    await db
      .insert(moderationThresholds)
      .values({ guildId, violationType: "new_account_guard", preset: "strong", enabled: true });
    const eventBus = fakeEventBus();
    const now = new Date();
    const userId = `u-${randomUUID()}`;

    const result = await handleGuildMemberAdd(
      deps(eventBus),
      member({ guildId, userId, accountCreatedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000), joinedAt: now }),
    );

    expect(result.newAccountGuardOutcome).not.toBeNull();
    expect(result.newAccountGuardOutcome?.violationType).toBe("new_account_guard");
    expect(eventBus.published).toHaveLength(1);

    const rows = await db
      .select()
      .from(moderationEscalationState)
      .where(eq(moderationEscalationState.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.violationType).toBe("new_account_guard");
  });

  test("new_account_guard: 作成から十分経過したアカウントの入室ではヒットしない", async () => {
    await db
      .insert(moderationThresholds)
      .values({ guildId, violationType: "new_account_guard", preset: "strong", enabled: true });
    const eventBus = fakeEventBus();
    const now = new Date();
    const userId = `u-${randomUUID()}`;

    const result = await handleGuildMemberAdd(
      deps(eventBus),
      member({ guildId, userId, accountCreatedAt: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000), joinedAt: now }),
    );

    expect(result.newAccountGuardOutcome).toBeNull();
    expect(eventBus.published).toEqual([]);
  });
});
