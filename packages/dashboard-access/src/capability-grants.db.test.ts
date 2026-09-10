import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, capabilityGrants, guilds } from "@management-bot/db";
import { CAPABILITIES } from "@management-bot/shared";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { grantCapabilities, listCapabilityGrants, revokeCapabilityGrant } from "./capability-grants.js";

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

describe("listCapabilityGrants", () => {
  test("grantが無いguildは空配列を返す", async () => {
    const result = await listCapabilityGrants(db, guildId);

    expect(result).toEqual([]);
  });

  test("user/role双方のgrantを返す", async () => {
    await db.insert(capabilityGrants).values([
      { id: randomUUID(), guildId, targetType: "user", targetId: "u1", capabilities: CAPABILITIES.VIEW_LOGS },
      { id: randomUUID(), guildId, targetType: "role", targetId: guildId, capabilities: CAPABILITIES.VIEW_ACTIVITY },
    ]);

    const result = await listCapabilityGrants(db, guildId);

    expect(result).toHaveLength(2);
    expect(result.find((g) => g.targetId === "u1")).toMatchObject({
      targetType: "user",
      capabilities: CAPABILITIES.VIEW_LOGS,
    });
    expect(result.find((g) => g.targetId === guildId)).toMatchObject({
      targetType: "role",
      capabilities: CAPABILITIES.VIEW_ACTIVITY,
    });
  });

  test("他guildのgrantは含まれない", async () => {
    const otherGuildId = `test-guild-${randomUUID()}`;
    await db.insert(guilds).values({ id: otherGuildId, name: "other" });
    await db
      .insert(capabilityGrants)
      .values({ id: randomUUID(), guildId: otherGuildId, targetType: "user", targetId: "u1", capabilities: 1 });

    try {
      const result = await listCapabilityGrants(db, guildId);
      expect(result).toEqual([]);
    } finally {
      await db.delete(guilds).where(eq(guilds.id, otherGuildId));
    }
  });
});

describe("grantCapabilities", () => {
  test("未付与のtargetに新規作成する", async () => {
    await grantCapabilities(db, {
      guildId,
      targetType: "user",
      targetId: "u1",
      capabilities: CAPABILITIES.VIEW_LOGS,
    });

    const rows = await db.select().from(capabilityGrants).where(eq(capabilityGrants.guildId, guildId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.capabilities).toBe(CAPABILITIES.VIEW_LOGS);
  });

  test("既存のgrantは上書きする(同一guild+targetType+targetIdは1レコード)", async () => {
    await grantCapabilities(db, {
      guildId,
      targetType: "user",
      targetId: "u1",
      capabilities: CAPABILITIES.VIEW_LOGS,
    });
    await grantCapabilities(db, {
      guildId,
      targetType: "user",
      targetId: "u1",
      capabilities: CAPABILITIES.VIEW_LOGS | CAPABILITIES.VIEW_LOGS_RAW,
    });

    const rows = await db.select().from(capabilityGrants).where(eq(capabilityGrants.guildId, guildId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.capabilities).toBe(CAPABILITIES.VIEW_LOGS | CAPABILITIES.VIEW_LOGS_RAW);
  });
});

describe("revokeCapabilityGrant", () => {
  test("既存のgrantを削除する", async () => {
    await grantCapabilities(db, {
      guildId,
      targetType: "user",
      targetId: "u1",
      capabilities: CAPABILITIES.VIEW_LOGS,
    });

    await revokeCapabilityGrant(db, { guildId, targetType: "user", targetId: "u1" });

    const rows = await db.select().from(capabilityGrants).where(eq(capabilityGrants.guildId, guildId));
    expect(rows).toHaveLength(0);
  });

  test("未付与のtargetを剥奪しても何も起きない", async () => {
    await revokeCapabilityGrant(db, { guildId, targetType: "user", targetId: "u1" });

    const rows = await db.select().from(capabilityGrants).where(eq(capabilityGrants.guildId, guildId));
    expect(rows).toHaveLength(0);
  });
});
