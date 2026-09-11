import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, type Db, guilds, moderationThresholds } from "@management-bot/db";
import { eq } from "drizzle-orm";
import { getEnabledThresholds, listThresholds, setThreshold } from "./thresholds.js";

describe("getEnabledThresholds", () => {
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

  test("設定が何もなければ空配列", async () => {
    expect(await getEnabledThresholds(db, guildId)).toEqual([]);
  });

  test("enabled=falseの行は含まれず、enabled=trueの行だけ返す", async () => {
    await db
      .insert(moderationThresholds)
      .values([
        { guildId, violationType: "flood", preset: "medium", enabled: true },
        { guildId, violationType: "duplicate_content", preset: "weak", enabled: false },
      ]);

    const result = await getEnabledThresholds(db, guildId);
    expect(result).toEqual([{ violationType: "flood", preset: "medium" }]);
  });
});

describe("listThresholds / setThreshold", () => {
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

  test("setThresholdは新規作成、既存への再setThresholdは上書きする", async () => {
    await setThreshold(db, guildId, "flood", "weak", true);
    expect(await listThresholds(db, guildId)).toEqual([{ violationType: "flood", preset: "weak", enabled: true }]);

    await setThreshold(db, guildId, "flood", "strong", false);
    expect(await listThresholds(db, guildId)).toEqual([
      { violationType: "flood", preset: "strong", enabled: false },
    ]);
  });
});
