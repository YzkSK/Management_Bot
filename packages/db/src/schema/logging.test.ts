import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "../client.ts";
import { guilds, logChannelSettings, logDisplaySettings, logEntries, logRetentionSettings } from "./index.ts";

interface PgErrorCause {
  code?: string;
  constraint_name?: string;
}

async function expectConstraintViolation(operation: Promise<unknown>, constraintName: string): Promise<void> {
  try {
    await operation;
  } catch (e) {
    const cause = (e as { cause?: PgErrorCause }).cause;
    expect(cause?.constraint_name).toBe(constraintName);
    return;
  }
  throw new Error(`expected constraint "${constraintName}" violation, but the operation succeeded`);
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
    await expectConstraintViolation(
      db.insert(logEntries).values({
        id: randomUUID(),
        guildId,
        category: "unknown-category",
        payload: {},
      }),
      "log_entries_category_check",
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

  test("log_retention_settingsはguild_id+categoryで一意、retention_daysは非負、categoryはCHECK制約で検証される", async () => {
    await db.insert(logRetentionSettings).values({ guildId, category: "message", retentionDays: 30 });

    await expectConstraintViolation(
      db.insert(logRetentionSettings).values({ guildId, category: "message", retentionDays: 10 }),
      "log_retention_settings_guild_id_category_pk",
    );
    await expectConstraintViolation(
      db.insert(logRetentionSettings).values({ guildId, category: "role", retentionDays: -1 }),
      "log_retention_settings_retention_days_check",
    );
    await expectConstraintViolation(
      db.insert(logRetentionSettings).values({ guildId, category: "unknown-category", retentionDays: 1 }),
      "log_retention_settings_category_check",
    );
  });

  test("log_channel_settingsはguild_id+categoryで一意、categoryはCHECK制約で検証される", async () => {
    await db.insert(logChannelSettings).values({ guildId, category: "message", channelId: "chan-1" });

    await expectConstraintViolation(
      db.insert(logChannelSettings).values({ guildId, category: "message", channelId: "chan-2" }),
      "log_channel_settings_guild_id_category_pk",
    );
    await expectConstraintViolation(
      db.insert(logChannelSettings).values({ guildId, category: "unknown-category", channelId: "chan-3" }),
      "log_channel_settings_category_check",
    );
  });

  test("log_display_settingsはguild_idを主キーに持ち、hide_audit_log_correlationはデフォルトでtrue", async () => {
    await db.insert(logDisplaySettings).values({ guildId });

    const [row] = await db
      .select()
      .from(logDisplaySettings)
      .where(eq(logDisplaySettings.guildId, guildId))
      .limit(1);
    expect(row?.hideAuditLogCorrelation).toBe(true);

    await expectConstraintViolation(
      db.insert(logDisplaySettings).values({ guildId }),
      "log_display_settings_pkey",
    );
  });
});
