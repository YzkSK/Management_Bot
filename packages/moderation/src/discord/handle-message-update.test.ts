import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, type Db, guilds, moderationEscalationState, moderationNgwords, moderationThresholds } from "@management-bot/db";
import type { ModerationActionRecordedEvent } from "@management-bot/shared";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import type { Message } from "discord.js";
import { createModerationConfigCache } from "../application/index.js";
import { addNgword } from "../application/ngwords.js";
import { handleMessageUpdate } from "./handle-message-update.js";

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
  const send = mock(() => Promise.resolve());
  return {
    author: { id: overrides.userId, bot: overrides.bot ?? false, send },
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
    send,
  };
}

describe.skipIf(!(await isRedisAvailable()))("handleMessageUpdate(#362-7.1)", () => {
  let db: Db;
  let close: () => Promise<void>;
  const redis = new Redis(REDIS_URL);
  const guildId = `test-guild-${randomUUID()}`;
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
    await db.delete(moderationEscalationState).where(eq(moderationEscalationState.guildId, guildId));
    await db.delete(moderationNgwords).where(eq(moderationNgwords.guildId, guildId));
    const keys = await redis.keys(`moderation:*:${guildId}:*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  function fakeEventBus() {
    const published: ModerationActionRecordedEvent[] = [];
    return { published, publish: async (event: ModerationActionRecordedEvent) => void published.push(event) };
  }

  const resolveInviteGuildId = async (): Promise<string | null> => guildId;

  function deps(
    eventBus: ReturnType<typeof fakeEventBus>,
    overrides: Partial<Parameters<typeof handleMessageUpdate>[0]> = {},
  ) {
    return { db, redis, eventBus, resolveInviteGuildId, configCache, ...overrides };
  }

  test("botのメッセージ編集は無視する", async () => {
    const eventBus = fakeEventBus();
    const message = fakeMessage({ guildId, userId: `u-${randomUUID()}`, content: "hi", bot: true });
    await handleMessageUpdate(deps(eventBus), message as unknown as Message);
    expect(eventBus.published).toEqual([]);
  });

  test("guild/memberがないメッセージ編集(DM等)は無視する", async () => {
    const eventBus = fakeEventBus();
    const message = fakeMessage({ guildId, userId: `u-${randomUUID()}`, content: "hi", hasGuild: false });
    await handleMessageUpdate(deps(eventBus), message as unknown as Message);
    expect(eventBus.published).toEqual([]);
  });

  test("編集後の内容がNGワードに一致すれば検知され、そのメッセージ自身が削除される", async () => {
    const userId = `u-${randomUUID()}`;
    await db.insert(moderationThresholds).values({ guildId, violationType: "ngword", preset: "medium", enabled: true });
    await addNgword(db, guildId, "exact", "banned-word");

    const eventBus = fakeEventBus();
    const message = fakeMessage({ guildId, userId, content: "banned-word" });
    await handleMessageUpdate(deps(eventBus), message as unknown as Message);

    expect(eventBus.published).toHaveLength(1);
    expect(eventBus.published[0]).toMatchObject({ action: "resolve", result: "success" });
    expect(message.deleteFn).toHaveBeenCalledTimes(1);
  });

  test("編集後の内容が他ギルドへの招待リンクを含めば検知され、そのメッセージ自身が削除される", async () => {
    const userId = `u-${randomUUID()}`;
    await db
      .insert(moderationThresholds)
      .values({ guildId, violationType: "invite_link", preset: "medium", enabled: true });

    const eventBus = fakeEventBus();
    const message = fakeMessage({ guildId, userId, content: "join us: discord.gg/other-guild-code" });
    await handleMessageUpdate(
      deps(eventBus, { resolveInviteGuildId: async () => "other-guild-id" }),
      message as unknown as Message,
    );

    expect(eventBus.published).toHaveLength(1);
    expect(eventBus.published[0]).toMatchObject({ action: "resolve", result: "success" });
    expect(message.deleteFn).toHaveBeenCalledTimes(1);
  });

  test("NGワードに一致しない編集は何も起きない", async () => {
    const userId = `u-${randomUUID()}`;
    await db.insert(moderationThresholds).values({ guildId, violationType: "ngword", preset: "medium", enabled: true });
    await addNgword(db, guildId, "exact", "banned-word");

    const eventBus = fakeEventBus();
    const message = fakeMessage({ guildId, userId, content: "clean message" });
    await handleMessageUpdate(deps(eventBus), message as unknown as Message);

    expect(eventBus.published).toEqual([]);
    expect(message.deleteFn).not.toHaveBeenCalled();
  });

  test("strikeロック中(10秒以内)の連続編集は、strikeは進まないがトリガーメッセージは削除される(#338と同様の扱い)", async () => {
    const userId = `u-${randomUUID()}`;
    await db.insert(moderationThresholds).values({ guildId, violationType: "ngword", preset: "medium", enabled: true });
    await addNgword(db, guildId, "exact", "banned-word");

    const eventBus = fakeEventBus();
    const first = fakeMessage({ guildId, userId, content: "banned-word" });
    await handleMessageUpdate(deps(eventBus), first as unknown as Message);

    const second = fakeMessage({ guildId, userId, content: "banned-word" });
    await handleMessageUpdate(deps(eventBus), second as unknown as Message);

    expect(eventBus.published).toHaveLength(1);
    expect(second.deleteFn).toHaveBeenCalledTimes(1);

    const [row] = await db
      .select()
      .from(moderationEscalationState)
      .where(eq(moderationEscalationState.userId, userId));
    expect(row?.strikeCount).toBe(1);
  });
});
