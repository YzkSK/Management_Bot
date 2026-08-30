import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "../client.ts";
import { guilds, logChannelSettings, logEntries, logRetentionSettings } from "./index.ts";

async function assertRejects(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    return;
  }
  throw new Error("expected promise to reject, but it resolved");
}

describe("logging schema", () => {
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

  test("log_entriesは未知のcategoryをCHECK制約で拒否する", async () => {
    await assertRejects(
      db.insert(logEntries).values({
        id: randomUUID(),
        guildId,
        category: "unknown-category",
        payload: {},
      }),
    );
  });

  test("log_entriesは既知のcategoryとjsonb payloadを保存できる", async () => {
    const id = randomUUID();
    await db.insert(logEntries).values({
      id,
      guildId,
      category: "message",
      payload: { action: "create", content: "hello" },
    });

    const [row] = await db.select().from(logEntries).where(eq(logEntries.id, id)).limit(1);
    expect(row?.payload).toEqual({ action: "create", content: "hello" });
  });

  test("log_retention_settingsはguild_id+categoryで一意、retention_daysは非負", async () => {
    await db.insert(logRetentionSettings).values({ guildId, category: "message", retentionDays: 30 });

    await assertRejects(
      db.insert(logRetentionSettings).values({ guildId, category: "message", retentionDays: 10 }),
    );
    await assertRejects(
      db.insert(logRetentionSettings).values({ guildId, category: "role", retentionDays: -1 }),
    );
  });

  test("log_channel_settingsはguild_id+categoryで一意", async () => {
    await db.insert(logChannelSettings).values({ guildId, category: "message", channelId: "chan-1" });

    await assertRejects(
      db.insert(logChannelSettings).values({ guildId, category: "message", channelId: "chan-2" }),
    );
  });
});
