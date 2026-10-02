import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createDb } from "./client.js";
import { capabilityGrants, guilds } from "./schema/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId = `test-guild-${randomUUID()}`;

const migrationStatements = readFileSync(
  new URL("../drizzle/0033_drop_unused_capabilities.sql", import.meta.url),
  "utf8",
).split("--> statement-breakpoint");

async function runMigration(): Promise<void> {
  for (const statement of migrationStatements) {
    await db.execute(sql.raw(statement));
  }
}

afterAll(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await close();
});

beforeEach(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await db.insert(guilds).values({ id: guildId, name: "guild" });
});

describe("0033_drop_unused_capabilities", () => {
  test("削除したビットだけを落とし、他のcapabilityは維持する。0になった行は削除する", async () => {
    // 旧フル管理者(0b111_1111_1111)、旧VIEW_MODERATIONのみ、VIEW_LOGS(1<<2)のみ
    await db.insert(capabilityGrants).values([
      { id: randomUUID(), guildId, targetType: "role", targetId: "full", capabilities: 0b111_1111_1111 },
      { id: randomUUID(), guildId, targetType: "role", targetId: "old-view-mod", capabilities: 1 << 7 },
      { id: randomUUID(), guildId, targetType: "user", targetId: "logs", capabilities: 1 << 2 },
    ]);

    await runMigration();

    const rows = await db
      .select({ targetId: capabilityGrants.targetId, capabilities: capabilityGrants.capabilities })
      .from(capabilityGrants)
      .where(eq(capabilityGrants.guildId, guildId));
    expect(rows.sort((a, b) => a.targetId.localeCompare(b.targetId))).toEqual([
      { targetId: "full", capabilities: 0b111_1111_1111 & ~((1 << 1) | (1 << 7) | (1 << 10)) },
      { targetId: "logs", capabilities: 1 << 2 },
    ]);
  });

  test("前提の閲覧権限が欠けた管理・生データ閲覧権限には閲覧権限を補う", async () => {
    // MANAGE_LOGGING_SETTINGS(1<<4)のみ、VIEW_LOGS_RAW(1<<3)のみ、MANAGE_TEMP_VOICE(1<<6)のみ
    await db.insert(capabilityGrants).values([
      { id: randomUUID(), guildId, targetType: "role", targetId: "log-manage", capabilities: 1 << 4 },
      { id: randomUUID(), guildId, targetType: "role", targetId: "log-raw", capabilities: 1 << 3 },
      { id: randomUUID(), guildId, targetType: "role", targetId: "vc-manage", capabilities: 1 << 6 },
    ]);

    await runMigration();

    const rows = await db
      .select({ targetId: capabilityGrants.targetId, capabilities: capabilityGrants.capabilities })
      .from(capabilityGrants)
      .where(eq(capabilityGrants.guildId, guildId));
    expect(rows.sort((a, b) => a.targetId.localeCompare(b.targetId))).toEqual([
      { targetId: "log-manage", capabilities: (1 << 4) | (1 << 2) },
      { targetId: "log-raw", capabilities: (1 << 3) | (1 << 2) },
      { targetId: "vc-manage", capabilities: (1 << 6) | (1 << 5) },
    ]);
  });
});
