import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, guilds, logChannelSettings } from "@management-bot/db";
import { LOG_CATEGORIES } from "@management-bot/shared";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { listChannelSettings, setChannelSetting, setChannelSettingForAllCategories } from "./channel-settings.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId = `test-guild-${randomUUID()}`;

afterAll(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await close();
});

beforeEach(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await db.insert(guilds).values({ id: guildId, name: "guild" });
});

describe("listChannelSettings", () => {
  test("未設定のギルドは全カテゴリchannelId=nullとして返す", async () => {
    const result = await listChannelSettings(db, guildId);

    expect(result).toHaveLength(LOG_CATEGORIES.length);
    expect(result.every((r) => r.channelId === null)).toBe(true);
  });

  test("設定済みのカテゴリはDB上のchannelId、未設定はnullとして返す", async () => {
    await db.insert(logChannelSettings).values({ guildId, category: "message", channelId: "c1" });

    const result = await listChannelSettings(db, guildId);

    expect(result.find((r) => r.category === "message")?.channelId).toBe("c1");
    expect(result.find((r) => r.category === "member")?.channelId).toBeNull();
  });
});

describe("setChannelSetting", () => {
  test("未設定のカテゴリに新規作成する", async () => {
    await setChannelSetting(db, guildId, "message", "c1");

    const rows = await db
      .select()
      .from(logChannelSettings)
      .where(eq(logChannelSettings.guildId, guildId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.channelId).toBe("c1");
  });

  test("既存の設定を上書きする", async () => {
    await setChannelSetting(db, guildId, "message", "c1");
    await setChannelSetting(db, guildId, "message", "c2");

    const rows = await db
      .select()
      .from(logChannelSettings)
      .where(eq(logChannelSettings.guildId, guildId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.channelId).toBe("c2");
  });

  test("channelId=nullで設定を削除する(未設定に戻す)", async () => {
    await setChannelSetting(db, guildId, "message", "c1");
    await setChannelSetting(db, guildId, "message", null);

    const rows = await db
      .select()
      .from(logChannelSettings)
      .where(eq(logChannelSettings.guildId, guildId));
    expect(rows).toHaveLength(0);
  });

  test("未設定の状態でchannelId=nullを渡しても何も起きない", async () => {
    await setChannelSetting(db, guildId, "message", null);

    const rows = await db
      .select()
      .from(logChannelSettings)
      .where(eq(logChannelSettings.guildId, guildId));
    expect(rows).toHaveLength(0);
  });
});

describe("setChannelSettingForAllCategories", () => {
  test("全カテゴリに同じchannelIdを設定する", async () => {
    await setChannelSettingForAllCategories(db, guildId, "c1");

    const result = await listChannelSettings(db, guildId);
    expect(result.every((r) => r.channelId === "c1")).toBe(true);
  });

  test("一部カテゴリだけ個別設定済みでも、全カテゴリを一括値で上書きする", async () => {
    await setChannelSetting(db, guildId, "message", "c1");

    await setChannelSettingForAllCategories(db, guildId, "c2");

    const result = await listChannelSettings(db, guildId);
    expect(result.every((r) => r.channelId === "c2")).toBe(true);
  });

  test("channelId=nullで全カテゴリの設定を削除する", async () => {
    await setChannelSettingForAllCategories(db, guildId, "c1");

    await setChannelSettingForAllCategories(db, guildId, null);

    const rows = await db.select().from(logChannelSettings).where(eq(logChannelSettings.guildId, guildId));
    expect(rows).toHaveLength(0);
  });
});
