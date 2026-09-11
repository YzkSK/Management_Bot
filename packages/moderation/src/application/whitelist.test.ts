import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, type Db, guilds, moderationWhitelist } from "@management-bot/db";
import { eq } from "drizzle-orm";
import { addToWhitelist, isWhitelisted, listWhitelist, removeFromWhitelist } from "./whitelist.js";

describe("isWhitelisted", () => {
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

  test("ホワイトリストが空ならfalse", async () => {
    expect(await isWhitelisted(db, guildId, "u1", [])).toBe(false);
  });

  test("targetType=userが一致するユーザーはtrue", async () => {
    const userId = `u-${randomUUID()}`;
    await db.insert(moderationWhitelist).values({ guildId, targetType: "user", targetId: userId });
    expect(await isWhitelisted(db, guildId, userId, [])).toBe(true);
    expect(await isWhitelisted(db, guildId, `${userId}-other`, [])).toBe(false);
  });

  test("targetType=roleが一致するロールを持つユーザーはtrue", async () => {
    const roleId = `r-${randomUUID()}`;
    await db.insert(moderationWhitelist).values({ guildId, targetType: "role", targetId: roleId });
    expect(await isWhitelisted(db, guildId, `u-${randomUUID()}`, [roleId])).toBe(true);
    expect(await isWhitelisted(db, guildId, `u-${randomUUID()}`, [`${roleId}-other`])).toBe(false);
  });
});

describe("listWhitelist / addToWhitelist / removeFromWhitelist", () => {
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

  test("追加・一覧・削除が一通り行える", async () => {
    const userId = `u-${randomUUID()}`;
    expect(await listWhitelist(db, guildId)).toEqual([]);

    await addToWhitelist(db, { guildId, targetType: "user", targetId: userId });
    expect(await listWhitelist(db, guildId)).toEqual([{ targetType: "user", targetId: userId }]);

    // 重複追加はconflictを無視する
    await addToWhitelist(db, { guildId, targetType: "user", targetId: userId });
    expect(await listWhitelist(db, guildId)).toHaveLength(1);

    await removeFromWhitelist(db, { guildId, targetType: "user", targetId: userId });
    expect(await listWhitelist(db, guildId)).toEqual([]);
  });

  test("未登録の対象を削除してもエラーにならない", async () => {
    await expect(
      removeFromWhitelist(db, { guildId, targetType: "role", targetId: `r-${randomUUID()}` }),
    ).resolves.toBeUndefined();
  });
});
