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
  test("未設定のguildはhideAuditLogCorrelation=true, hideBotEvents=trueを返す(デフォルトON)", async () => {
    const settings = await getDisplaySettings(db, guildId);
    expect(settings.hideAuditLogCorrelation).toBe(true);
    expect(settings.hideBotEvents).toBe(true);
  });

  test("setDisplaySettingでfalseに変更できる", async () => {
    await setDisplaySetting(db, guildId, { hideAuditLogCorrelation: false, hideBotEvents: false });
    const settings = await getDisplaySettings(db, guildId);
    expect(settings.hideAuditLogCorrelation).toBe(false);
    expect(settings.hideBotEvents).toBe(false);
  });

  test("falseに変更後trueに戻せる", async () => {
    await setDisplaySetting(db, guildId, { hideAuditLogCorrelation: false, hideBotEvents: false });
    await setDisplaySetting(db, guildId, { hideAuditLogCorrelation: true, hideBotEvents: true });
    const settings = await getDisplaySettings(db, guildId);
    expect(settings.hideAuditLogCorrelation).toBe(true);
    expect(settings.hideBotEvents).toBe(true);
  });

  test("片方のみのpatchはもう片方の既存値を変更しない(部分更新)", async () => {
    await setDisplaySetting(db, guildId, { hideAuditLogCorrelation: false, hideBotEvents: false });

    await setDisplaySetting(db, guildId, { hideAuditLogCorrelation: true });
    const settings = await getDisplaySettings(db, guildId);

    expect(settings.hideAuditLogCorrelation).toBe(true);
    expect(settings.hideBotEvents).toBe(false);
  });
});
