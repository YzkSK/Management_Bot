import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, guilds } from "@management-bot/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDisplaySettings, setDisplaySetting } from "./display-settings.js";

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

describe("display-settings", () => {
  test("未設定のguildはhideAuditLogCorrelation=trueを返す(デフォルトON)", async () => {
    const settings = await getDisplaySettings(db, guildId);
    expect(settings.hideAuditLogCorrelation).toBe(true);
  });

  test("setDisplaySettingでfalseに変更できる", async () => {
    await setDisplaySetting(db, guildId, false);
    const settings = await getDisplaySettings(db, guildId);
    expect(settings.hideAuditLogCorrelation).toBe(false);
  });

  test("falseに変更後trueに戻せる", async () => {
    await setDisplaySetting(db, guildId, false);
    await setDisplaySetting(db, guildId, true);
    const settings = await getDisplaySettings(db, guildId);
    expect(settings.hideAuditLogCorrelation).toBe(true);
  });
});
