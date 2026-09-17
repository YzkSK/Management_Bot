import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
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
import type { GuildMember } from "discord.js";
import { setEscalationPreset } from "../application/escalation-settings.js";
import { handleGuildMemberAddEvent } from "./handle-guild-member-add.js";

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

function fakeMember(overrides: {
  guildId: string;
  userId: string;
  accountCreatedAt: Date;
  joinedAt: Date;
  bot?: boolean;
  fetchImpl?: (userId: string) => Promise<{ timeout: ReturnType<typeof mock> }>;
}) {
  const timeout = mock(() => Promise.resolve());
  const kick = mock(() => Promise.resolve());
  const ban = mock(() => Promise.resolve());
  const fetchedMembers = new Map<string, { timeout: ReturnType<typeof mock> }>();
  const fetch = mock(async (userId: string) => {
    if (!fetchedMembers.has(userId)) {
      fetchedMembers.set(userId, { timeout: mock(() => Promise.resolve()) });
    }
    return fetchedMembers.get(userId);
  });
  return {
    id: overrides.userId,
    user: { id: overrides.userId, bot: overrides.bot ?? false, createdAt: overrides.accountCreatedAt },
    guild: { id: overrides.guildId, members: { fetch } },
    roles: { cache: new Map() },
    joinedAt: overrides.joinedAt,
    timeout,
    kick,
    ban,
    fetch,
    fetchedMembers,
  };
}

describe.skipIf(!(await isRedisAvailable()))("handleGuildMemberAddEvent", () => {
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
    await db.delete(moderationRaidState).where(eq(moderationRaidState.guildId, guildId));
    const keys = await redis.keys(`moderation:raid:${guildId}`);
    if (keys.length > 0) await redis.del(...keys);
  });

  function fakeEventBus() {
    const published: ModerationActionRecordedEvent[] = [];
    return { published, publish: async (event: ModerationActionRecordedEvent) => void published.push(event) };
  }

  test("botの入室は無視する", async () => {
    const eventBus = fakeEventBus();
    const now = new Date();
    const member = fakeMember({ guildId, userId: `u-${randomUUID()}`, accountCreatedAt: now, joinedAt: now, bot: true });
    await handleGuildMemberAddEvent({ db, redis, eventBus }, member as unknown as GuildMember);
    expect(eventBus.published).toEqual([]);
  });

  test("raid: strong presetの閾値(6人)に達すると対象ユーザー全員にtimeoutが実行される", async () => {
    await db.insert(moderationThresholds).values({ guildId, violationType: "raid", preset: "strong", enabled: true });
    const eventBus = fakeEventBus();
    const now = new Date();
    const oldAccountCreatedAt = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    const members = Array.from({ length: 6 }, () =>
      fakeMember({ guildId, userId: `u-${randomUUID()}`, accountCreatedAt: oldAccountCreatedAt, joinedAt: now }),
    );

    for (const member of members) {
      await handleGuildMemberAddEvent({ db, redis, eventBus }, member as unknown as GuildMember);
    }

    // 各GuildMember.guild.members.fetchが対象ユーザーごとに呼ばれ、fetchで得たmemberにtimeoutが実行される。
    const lastMember = members[members.length - 1];
    expect(lastMember?.fetch).toHaveBeenCalledTimes(6);
    for (const fetched of lastMember?.fetchedMembers.values() ?? []) {
      expect(fetched.timeout).toHaveBeenCalledTimes(1);
    }
    expect(eventBus.published.filter((e) => e.actionType === "timeout")).toHaveLength(6);
  });

  test("raid: ホワイトリスト対象の入室はカウントされず一括timeoutの対象にもならない", async () => {
    await db.insert(moderationThresholds).values({ guildId, violationType: "raid", preset: "strong", enabled: true });
    const whitelistedUserId = `u-${randomUUID()}`;
    await db.insert(moderationWhitelist).values({ guildId, targetType: "user", targetId: whitelistedUserId });

    const eventBus = fakeEventBus();
    const now = new Date();

    const whitelistedMember = fakeMember({ guildId, userId: whitelistedUserId, accountCreatedAt: now, joinedAt: now });
    await handleGuildMemberAddEvent({ db, redis, eventBus }, whitelistedMember as unknown as GuildMember);
    expect(whitelistedMember.timeout).not.toHaveBeenCalled();
    expect(eventBus.published).toEqual([]);
  });

  test("new_account_guard: 作成間もないアカウントの入室にtimeoutが実行される", async () => {
    await db
      .insert(moderationThresholds)
      .values({ guildId, violationType: "new_account_guard", preset: "strong", enabled: true });
    // strong preset(エスカレーション強度)を明示指定。ESCALATION_STEPS.strong[1]=warn/[2]=timeoutなので、
    // まず1回warnさせてから2回目でtimeoutを確認する。
    await setEscalationPreset(db, guildId, "strong");
    const eventBus = fakeEventBus();
    const now = new Date();
    const userId = `u-${randomUUID()}`;
    const recentAccountCreatedAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const first = fakeMember({ guildId, userId, accountCreatedAt: recentAccountCreatedAt, joinedAt: now });
    await handleGuildMemberAddEvent({ db, redis, eventBus }, first as unknown as GuildMember);
    expect(first.timeout).not.toHaveBeenCalled();

    const second = fakeMember({ guildId, userId, accountCreatedAt: recentAccountCreatedAt, joinedAt: now });
    await handleGuildMemberAddEvent({ db, redis, eventBus }, second as unknown as GuildMember);
    expect(second.timeout).toHaveBeenCalledTimes(1);

    expect(eventBus.published).toHaveLength(2);
    expect(eventBus.published[0]?.actionType).toBe("warn");
    expect(eventBus.published[1]?.actionType).toBe("timeout");
  });

  test("new_account_guard: 作成から十分経過したアカウントの入室では何も実行されない", async () => {
    await db
      .insert(moderationThresholds)
      .values({ guildId, violationType: "new_account_guard", preset: "strong", enabled: true });
    const eventBus = fakeEventBus();
    const now = new Date();
    const oldAccountCreatedAt = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const userId = `u-${randomUUID()}`;

    const member = fakeMember({ guildId, userId, accountCreatedAt: oldAccountCreatedAt, joinedAt: now });
    await handleGuildMemberAddEvent({ db, redis, eventBus }, member as unknown as GuildMember);

    expect(member.timeout).not.toHaveBeenCalled();
    expect(eventBus.published).toEqual([]);
  });
});
