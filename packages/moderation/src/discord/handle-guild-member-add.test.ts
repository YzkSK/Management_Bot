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
}) {
  const timeout = mock(() => Promise.resolve());
  const kick = mock(() => Promise.resolve());
  const ban = mock(() => Promise.resolve());
  const fetchedMembers = new Map<
    string,
    { id: string; guild: { id: string }; timeout: ReturnType<typeof mock> }
  >();
  const fetch = mock(async (userId: string) => {
    if (!fetchedMembers.has(userId)) {
      fetchedMembers.set(userId, {
        id: userId,
        guild: { id: overrides.guildId },
        timeout: mock(() => Promise.resolve()),
      });
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

    // 6人目(トリガーとなった入室者自身)は直接member.timeout()が呼ばれ、
    // 残り5人はguild.members.fetch()経由でtimeoutが実行される(Codexレビュー指摘対応:
    // raid対象とnew_account_guard対象が同一人物の場合の二重timeout上書きを防ぐため、
    // トリガー本人にはfetchを経由せず直接実行する設計)。
    const lastMember = members[members.length - 1];
    expect(lastMember?.fetch).toHaveBeenCalledTimes(5);
    expect(lastMember?.timeout).toHaveBeenCalledTimes(1);
    for (const fetched of lastMember?.fetchedMembers.values() ?? []) {
      expect(fetched.timeout).toHaveBeenCalledTimes(1);
    }
    // create×6(対象ユーザー全員分)→resolve×6(実行結果、#350)。
    const timeoutEvents = eventBus.published.filter((e) => e.actionType === "timeout");
    expect(timeoutEvents).toHaveLength(12);
    expect(timeoutEvents.filter((e) => e.action === "create")).toHaveLength(6);
    const resolveEvents = timeoutEvents.filter((e) => e.action === "resolve");
    expect(resolveEvents).toHaveLength(6);
    expect(resolveEvents.every((e) => e.action === "resolve" && e.result === "success")).toBe(true);
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

    // 1件目: warn(create+resolve)、2件目: timeout(create+resolve)の計4件(#350)。
    expect(eventBus.published).toHaveLength(4);
    expect(eventBus.published[0]).toMatchObject({ action: "create", actionType: "warn" });
    expect(eventBus.published[1]).toMatchObject({ action: "resolve", actionType: "warn", result: "success" });
    expect(eventBus.published[2]).toMatchObject({ action: "create", actionType: "timeout" });
    expect(eventBus.published[3]).toMatchObject({ action: "resolve", actionType: "timeout", result: "success" });
  });

  test("raid+new_account_guardが同一入室者に同時ヒットした場合、より重いraidのtimeoutのみが実行される(new_account_guardのtimeoutで上書きされない)", async () => {
    await db.insert(moderationThresholds).values([
      { guildId, violationType: "raid", preset: "strong", enabled: true },
      { guildId, violationType: "new_account_guard", preset: "strong", enabled: true },
    ]);
    // new_account_guardのESCALATION_STEPS.strong[1]=warn/[2]=timeout(5分)。
    // raidのstrong presetのtimeoutMinutesはnormal=60分/high=1440分、どちらもnew_account_guardの
    // 5分より長いため、raid側のtimeoutだけが実行されればよい。
    await setEscalationPreset(db, guildId, "strong");
    const eventBus = fakeEventBus();
    const now = new Date();
    const recentAccountCreatedAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // new_account_guardを先に1回warnさせ、6人目の入室でstrikeCount=2(timeout)に到達させつつ、
    // raidの閾値(6人)にも同時到達させる。
    const userId = `u-${randomUUID()}`;
    const warmup = fakeMember({ guildId, userId, accountCreatedAt: recentAccountCreatedAt, joinedAt: now });
    await handleGuildMemberAddEvent({ db, redis, eventBus }, warmup as unknown as GuildMember);

    const otherMembers = Array.from({ length: 4 }, () =>
      fakeMember({ guildId, userId: `u-${randomUUID()}`, accountCreatedAt: recentAccountCreatedAt, joinedAt: now }),
    );
    for (const member of otherMembers) {
      await handleGuildMemberAddEvent({ db, redis, eventBus }, member as unknown as GuildMember);
    }

    // 6人目として同一ユーザー(userId)が再入室したことにする(new_account_guardのstrikeCount=2で
    // timeoutに到達、同時にraidの6人目としてもヒットする状況を再現)。
    const trigger = fakeMember({ guildId, userId, accountCreatedAt: recentAccountCreatedAt, joinedAt: now });
    await handleGuildMemberAddEvent({ db, redis, eventBus }, trigger as unknown as GuildMember);

    // raid(1440分 or 60分)のtimeoutが1回だけ呼ばれ、new_account_guardの5分timeoutでは上書きされない。
    expect(trigger.timeout).toHaveBeenCalledTimes(1);
    const timeoutCallArgs = trigger.timeout.mock.calls[0] as unknown[] | undefined;
    const timeoutMs = timeoutCallArgs?.[0] as number | undefined;
    expect(timeoutMs).toBeGreaterThan(5 * 60 * 1000);

    // 実行されなかったnew_account_guard側(trigger分)のcreateには、未解決のまま残さないよう
    // result="skipped"のresolveがpublishされる(#350)。
    const skippedResolves = eventBus.published.filter((e) => e.action === "resolve" && e.result === "skipped");
    expect(skippedResolves).toHaveLength(1);
    expect(skippedResolves[0]).toMatchObject({ targetUserId: userId, actionType: "timeout" });
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
