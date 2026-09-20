import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  createDb,
  type Db,
  guilds,
  moderationEscalationState,
  moderationRaidState,
  moderationLockdownSettings,
  moderationThresholds,
  moderationWhitelist,
} from "@management-bot/db";
import type { ModerationActionRecordedEvent } from "@management-bot/shared";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import type { GuildMember } from "discord.js";
import { createModerationConfigCache, getLockdownSettings, markLockdownApplied, setAutoLockdownOnRaid } from "../application/index.js";
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
}) {
  const timeout = mock(() => Promise.resolve());
  const kick = mock(() => Promise.resolve());
  const ban = mock(() => Promise.resolve());
  const send = mock(() => Promise.resolve());
  const fetchedMembers = new Map<
    string,
    { id: string; guild: { id: string }; kick: ReturnType<typeof mock>; user: { send: ReturnType<typeof mock> } }
  >();
  const fetch = mock(async (userId: string) => {
    if (!fetchedMembers.has(userId)) {
      fetchedMembers.set(userId, {
        id: userId,
        guild: { id: overrides.guildId },
        kick: mock(() => Promise.resolve()),
        user: { send: mock(() => Promise.resolve()) },
      });
    }
    return fetchedMembers.get(userId);
  });
  return {
    id: overrides.userId,
    user: { id: overrides.userId, bot: overrides.bot ?? false, createdAt: overrides.accountCreatedAt, send },
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
    await db.delete(moderationLockdownSettings).where(eq(moderationLockdownSettings.guildId, guildId));
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

  test("botの入室は無視する", async () => {
    const eventBus = fakeEventBus();
    const now = new Date();
    const member = fakeMember({ guildId, userId: `u-${randomUUID()}`, accountCreatedAt: now, joinedAt: now, bot: true });
    await handleGuildMemberAddEvent(deps(eventBus), member as unknown as GuildMember);
    expect(eventBus.published).toEqual([]);
  });

  test("ロックダウン中の新規参加者は通常の判定を行わず即座にkickする", async () => {
    await markLockdownApplied(db, guildId, true);
    const eventBus = fakeEventBus();
    const now = new Date();
    const member = fakeMember({ guildId, userId: `u-${randomUUID()}`, accountCreatedAt: now, joinedAt: now });

    await handleGuildMemberAddEvent(deps(eventBus), member as unknown as GuildMember);

    expect(member.user.send).toHaveBeenCalledWith(
      "レイド対策のため、一時的にサーバーから退出させました。誤判定の場合はサーバー管理者へ連絡してください。",
    );
    expect(member.kick).toHaveBeenCalledTimes(1);
    expect(eventBus.published).toEqual([]);
  });

  test("raid: strong presetの閾値(6人)に達すると対象ユーザー全員にkickとDMが実行される", async () => {
    await db.insert(moderationThresholds).values({ guildId, violationType: "raid", preset: "strong", enabled: true });
    const eventBus = fakeEventBus();
    const now = new Date();
    const oldAccountCreatedAt = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    const members = Array.from({ length: 6 }, () =>
      fakeMember({ guildId, userId: `u-${randomUUID()}`, accountCreatedAt: oldAccountCreatedAt, joinedAt: now }),
    );

    for (const member of members) {
      await handleGuildMemberAddEvent(deps(eventBus), member as unknown as GuildMember);
    }

    // 6人目は直接kick、残り5人はguild.members.fetch()経由でkickする。
    const lastMember = members[members.length - 1];
    expect(lastMember?.fetch).toHaveBeenCalledTimes(5);
    expect(lastMember?.kick).toHaveBeenCalledTimes(1);
    expect(lastMember?.user.send).toHaveBeenCalledTimes(1);
    for (const fetched of lastMember?.fetchedMembers.values() ?? []) {
      expect(fetched.kick).toHaveBeenCalledTimes(1);
      expect(fetched.user.send).toHaveBeenCalledTimes(1);
    }
    // create×6(対象ユーザー全員分)→resolve×6(実行結果、#350)。
    const kickEvents = eventBus.published.filter((e) => e.actionType === "kick");
    expect(kickEvents).toHaveLength(12);
    expect(kickEvents.filter((e) => e.action === "create")).toHaveLength(6);
    const resolveEvents = kickEvents.filter((e) => e.action === "resolve");
    expect(resolveEvents).toHaveLength(6);
    expect(resolveEvents.every((e) => e.action === "resolve" && e.result === "success")).toBe(true);
  });

  test("自動ロックが有効ならレイド検知時に @everyone の送信権限を停止する", async () => {
    await db.insert(moderationThresholds).values({ guildId, violationType: "raid", preset: "strong", enabled: true });
    await setAutoLockdownOnRaid(db, guildId, true);
    const eventBus = fakeEventBus();
    const now = new Date();
    const oldAccountCreatedAt = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const members = Array.from({ length: 6 }, () =>
      fakeMember({ guildId, userId: `u-${randomUUID()}`, accountCreatedAt: oldAccountCreatedAt, joinedAt: now }),
    );
    const edit = mock(() => Promise.resolve());
    const trigger = members[members.length - 1];
    if (!trigger) throw new Error("raid trigger member is required");
    Object.assign(trigger.guild, {
      channels: {
        cache: new Map([
          [
            "channel-1",
            {
              id: "channel-1",
              isTextBased: () => true,
              isThread: () => false,
              permissionOverwrites: { cache: new Map(), edit },
            },
          ],
        ]),
      },
    });

    for (const member of members) {
      await handleGuildMemberAddEvent(deps(eventBus), member as unknown as GuildMember);
    }

    expect(edit).toHaveBeenCalledWith(guildId, { SendMessages: false });
    expect(await getLockdownSettings(db, guildId)).toMatchObject({ requestedLocked: true, isLocked: true });
  });

  test("raid: ホワイトリスト対象の入室はカウントされず一括timeoutの対象にもならない", async () => {
    await db.insert(moderationThresholds).values({ guildId, violationType: "raid", preset: "strong", enabled: true });
    const whitelistedUserId = `u-${randomUUID()}`;
    await db.insert(moderationWhitelist).values({ guildId, targetType: "user", targetId: whitelistedUserId });

    const eventBus = fakeEventBus();
    const now = new Date();

    const whitelistedMember = fakeMember({ guildId, userId: whitelistedUserId, accountCreatedAt: now, joinedAt: now });
    await handleGuildMemberAddEvent(deps(eventBus), whitelistedMember as unknown as GuildMember);
    expect(whitelistedMember.timeout).not.toHaveBeenCalled();
    expect(eventBus.published).toEqual([]);
  });

});
