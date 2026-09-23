import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, guilds, tempVoiceChannels, tempVoiceDenyProtectedRoles } from "@management-bot/db";
import { eq } from "drizzle-orm";
import {
  deletePermissionOverride,
  isDenyProtectedRole,
  listDenyProtectedRoleIds,
  listPermissionOverrides,
  upsertPermissionOverride,
} from "./permission-overrides.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId = `test-guild-${randomUUID()}`;
const channelId = `channel-${randomUUID()}`;

afterAll(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await close();
});

beforeEach(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await db.insert(guilds).values({ id: guildId, name: "guild" });
  await db.insert(tempVoiceChannels).values({ channelId, guildId, controlChannelId: "control-1", ownerId: "owner-1" });
});

describe("upsertPermissionOverride / listPermissionOverrides", () => {
  test("登録した行が一覧で取得できる", async () => {
    await upsertPermissionOverride(db, { channelId, targetType: "user", targetId: "user-1", state: "allow" });

    const rows = await listPermissionOverrides(db, channelId);

    expect(rows).toEqual([{ channelId, targetType: "user", targetId: "user-1", state: "allow" }]);
  });

  test("同一targetへの再登録はstateを上書きする(UPSERT)", async () => {
    await upsertPermissionOverride(db, { channelId, targetType: "role", targetId: "role-1", state: "allow" });
    await upsertPermissionOverride(db, { channelId, targetType: "role", targetId: "role-1", state: "deny" });

    const rows = await listPermissionOverrides(db, channelId);

    expect(rows).toEqual([{ channelId, targetType: "role", targetId: "role-1", state: "deny" }]);
  });

  test("複数のtargetを登録できる", async () => {
    await upsertPermissionOverride(db, { channelId, targetType: "user", targetId: "user-1", state: "allow" });
    await upsertPermissionOverride(db, { channelId, targetType: "role", targetId: "role-1", state: "deny" });

    const rows = await listPermissionOverrides(db, channelId);

    expect(rows).toHaveLength(2);
  });
});

describe("deletePermissionOverride", () => {
  test("削除した行は一覧から消える", async () => {
    await upsertPermissionOverride(db, { channelId, targetType: "user", targetId: "user-1", state: "allow" });

    await deletePermissionOverride(db, channelId, "user", "user-1");

    expect(await listPermissionOverrides(db, channelId)).toEqual([]);
  });
});

describe("listDenyProtectedRoleIds / isDenyProtectedRole", () => {
  test("保護ロール未設定ならisDenyProtectedRoleはfalse", async () => {
    expect(await isDenyProtectedRole(db, guildId, "role-1")).toBe(false);
  });

  test("保護ロール登録済みならtrue", async () => {
    await db.insert(tempVoiceDenyProtectedRoles).values({ guildId, roleId: "role-1" });

    expect(await isDenyProtectedRole(db, guildId, "role-1")).toBe(true);
    expect(await listDenyProtectedRoleIds(db, guildId)).toEqual(["role-1"]);
  });

  test("@everyone(roleId===guildId)は保護ロール未登録でも常にtrue", async () => {
    expect(await isDenyProtectedRole(db, guildId, guildId)).toBe(true);
  });
});
