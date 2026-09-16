import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, type Db, guilds } from "@management-bot/db";
import { eq } from "drizzle-orm";
import { getEscalationPreset, setEscalationPreset } from "./escalation-settings.js";

describe("escalation-settings", () => {
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

  test("未設定のguildはデフォルトmediumを返す", async () => {
    const freshGuildId = `test-guild-${randomUUID()}`;
    await db.insert(guilds).values({ id: freshGuildId, name: "Fresh Guild" });

    expect(await getEscalationPreset(db, freshGuildId)).toBe("medium");
  });

  test("setEscalationPreset後はその値を返す", async () => {
    await setEscalationPreset(db, guildId, "strong");
    expect(await getEscalationPreset(db, guildId)).toBe("strong");
  });

  test("setEscalationPresetは既存行を上書きする(2回目の呼び出し)", async () => {
    await setEscalationPreset(db, guildId, "weak");
    await setEscalationPreset(db, guildId, "strong");
    expect(await getEscalationPreset(db, guildId)).toBe("strong");
  });
});
