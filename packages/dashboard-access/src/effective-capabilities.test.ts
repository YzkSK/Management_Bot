import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, capabilityGrants, guilds } from "@management-bot/db";
import { ALL_CAPABILITIES, CAPABILITIES } from "@management-bot/shared";
import { resolveEffectiveCapabilities } from "./effective-capabilities.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await db.delete(capabilityGrants);
  await db.delete(guilds);
  await db.insert(guilds).values({ id: "guild-1", name: "test guild" });
});

describe("resolveEffectiveCapabilities", () => {
  test("ギルドオーナーは無条件でALL_CAPABILITIESを持つ", async () => {
    const result = await resolveEffectiveCapabilities(db, {
      guildId: "guild-1",
      discordUserId: "owner-1",
      isOwner: true,
      roleIds: [],
    });

    expect(result).toBe(ALL_CAPABILITIES);
  });

  test("user向けgrantのcapabilitiesを返す", async () => {
    await db.insert(capabilityGrants).values({
      id: "grant-1",
      guildId: "guild-1",
      targetType: "user",
      targetId: "user-1",
      capabilities: CAPABILITIES.VIEW_ACTIVITY,
    });

    const result = await resolveEffectiveCapabilities(db, {
      guildId: "guild-1",
      discordUserId: "user-1",
      isOwner: false,
      roleIds: [],
    });

    expect(result).toBe(CAPABILITIES.VIEW_ACTIVITY);
  });

  test("role向けgrantとuser向けgrantをOR結合する", async () => {
    await db.insert(capabilityGrants).values([
      {
        id: "grant-1",
        guildId: "guild-1",
        targetType: "user",
        targetId: "user-1",
        capabilities: CAPABILITIES.VIEW_ACTIVITY,
      },
      {
        id: "grant-2",
        guildId: "guild-1",
        targetType: "role",
        targetId: "role-1",
        capabilities: CAPABILITIES.VIEW_LOGS,
      },
    ]);

    const result = await resolveEffectiveCapabilities(db, {
      guildId: "guild-1",
      discordUserId: "user-1",
      isOwner: false,
      roleIds: ["role-1"],
    });

    expect(result).toBe(CAPABILITIES.VIEW_ACTIVITY | CAPABILITIES.VIEW_LOGS);
  });

  test("該当するgrantがなければ0を返す", async () => {
    const result = await resolveEffectiveCapabilities(db, {
      guildId: "guild-1",
      discordUserId: "user-1",
      isOwner: false,
      roleIds: [],
    });

    expect(result).toBe(0);
  });

  test("別ギルドのgrantは無視する", async () => {
    await db.insert(guilds).values({ id: "guild-2", name: "other guild" });
    await db.insert(capabilityGrants).values({
      id: "grant-1",
      guildId: "guild-2",
      targetType: "user",
      targetId: "user-1",
      capabilities: CAPABILITIES.VIEW_ACTIVITY,
    });

    const result = await resolveEffectiveCapabilities(db, {
      guildId: "guild-1",
      discordUserId: "user-1",
      isOwner: false,
      roleIds: [],
    });

    expect(result).toBe(0);
  });

  test("@everyoneロール(targetId===guildId)へのgrantはroleIdsを渡さなくても適用される", async () => {
    await db.insert(capabilityGrants).values({
      id: "grant-1",
      guildId: "guild-1",
      targetType: "role",
      targetId: "guild-1",
      capabilities: CAPABILITIES.VIEW_ACTIVITY,
    });

    const result = await resolveEffectiveCapabilities(db, {
      guildId: "guild-1",
      discordUserId: "user-1",
      isOwner: false,
      roleIds: [],
    });

    expect(result).toBe(CAPABILITIES.VIEW_ACTIVITY);
  });

  test("不正なcapabilitiesマスク(未知ビットを含む)を持つgrantは無視する", async () => {
    await db.insert(capabilityGrants).values({
      id: "grant-1",
      guildId: "guild-1",
      targetType: "user",
      targetId: "user-1",
      capabilities: 1 << 20,
    });

    const result = await resolveEffectiveCapabilities(db, {
      guildId: "guild-1",
      discordUserId: "user-1",
      isOwner: false,
      roleIds: [],
    });

    expect(result).toBe(0);
  });
});
