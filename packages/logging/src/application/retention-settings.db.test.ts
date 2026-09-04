import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, guilds, logRetentionSettings } from "@management-bot/db";
import { LOG_CATEGORIES } from "@management-bot/shared";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { listRetentionSettings, setRetentionSetting } from "./retention-settings.js";

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

describe("listRetentionSettings", () => {
  test("未設定のギルドは全カテゴリretentionDays=0として返す", async () => {
    const result = await listRetentionSettings(db, guildId);

    expect(result).toHaveLength(LOG_CATEGORIES.length);
    expect(result.every((r) => r.retentionDays === 0)).toBe(true);
  });

  test("設定済みのカテゴリはDB上の値、未設定は0として返す", async () => {
    await db.insert(logRetentionSettings).values({ guildId, category: "message", retentionDays: 30 });

    const result = await listRetentionSettings(db, guildId);

    expect(result.find((r) => r.category === "message")?.retentionDays).toBe(30);
    expect(result.find((r) => r.category === "member")?.retentionDays).toBe(0);
  });
});

describe("setRetentionSetting", () => {
  test("未設定のカテゴリに新規作成する", async () => {
    await setRetentionSetting(db, guildId, "message", 14);

    const rows = await db
      .select()
      .from(logRetentionSettings)
      .where(eq(logRetentionSettings.guildId, guildId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.retentionDays).toBe(14);
  });

  test("既存の設定を上書きする", async () => {
    await setRetentionSetting(db, guildId, "message", 14);
    await setRetentionSetting(db, guildId, "message", 7);

    const rows = await db
      .select()
      .from(logRetentionSettings)
      .where(eq(logRetentionSettings.guildId, guildId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.retentionDays).toBe(7);
  });
});
