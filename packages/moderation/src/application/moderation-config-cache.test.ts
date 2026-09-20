import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, type Db, guilds, moderationThresholds, moderationWhitelist } from "@management-bot/db";
import { eq } from "drizzle-orm";
import { createModerationConfigCache } from "./moderation-config-cache.js";

describe("createModerationConfigCache", () => {
  let db: Db;
  let close: () => Promise<void>;
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
  });

  test("whitelist/thresholds/ngwordsをまとめて1つのスナップショットとして取得する", async () => {
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });
    await db.insert(moderationWhitelist).values({ guildId, targetType: "user", targetId: "u1" });

    const cache = createModerationConfigCache();
    const snapshot = await cache.get(db, guildId);

    expect(snapshot.whitelist).toEqual([{ targetType: "user", targetId: "u1" }]);
    expect(snapshot.enabledThresholds).toEqual([{ violationType: "flood", preset: "strong" }]);
    expect(snapshot.ngwords).toEqual([]);

    await db.delete(moderationThresholds).where(eq(moderationThresholds.guildId, guildId));
    await db.delete(moderationWhitelist).where(eq(moderationWhitelist.guildId, guildId));
  });

  test("TTL内はDBへ問い合わせ直さずキャッシュを返す(DB更新後も古いスナップショットのまま)", async () => {
    const cache = createModerationConfigCache(10_000);
    const first = await cache.get(db, guildId);
    expect(first.enabledThresholds).toEqual([]);

    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });
    const second = await cache.get(db, guildId);

    expect(second.enabledThresholds).toEqual([]);

    await db.delete(moderationThresholds).where(eq(moderationThresholds.guildId, guildId));
  });

  test("invalidateすると次回get()はTTLを待たず再取得する", async () => {
    const cache = createModerationConfigCache(10_000);
    const first = await cache.get(db, guildId);
    expect(first.enabledThresholds).toEqual([]);

    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });
    cache.invalidate(guildId);
    const second = await cache.get(db, guildId);

    expect(second.enabledThresholds).toEqual([{ violationType: "flood", preset: "strong" }]);

    await db.delete(moderationThresholds).where(eq(moderationThresholds.guildId, guildId));
  });

  test("guildIdが異なれば別々にキャッシュする", async () => {
    const otherGuildId = `test-guild-${randomUUID()}`;
    await db.insert(guilds).values({ id: otherGuildId, name: "Other Guild" });
    await db.insert(moderationThresholds).values({ guildId: otherGuildId, violationType: "ngword", preset: "medium", enabled: true });

    const cache = createModerationConfigCache();
    const a = await cache.get(db, guildId);
    const b = await cache.get(db, otherGuildId);

    expect(a.enabledThresholds).toEqual([]);
    expect(b.enabledThresholds).toEqual([{ violationType: "ngword", preset: "medium" }]);

    await db.delete(guilds).where(eq(guilds.id, otherGuildId));
  });
});
