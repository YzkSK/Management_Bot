import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, guilds } from "@management-bot/db";
import { inArray } from "drizzle-orm";
import { buildGuildIconUrl, isManagedGuild, listMyGuilds } from "./list-my-guilds.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildIds = ["bot-installed-1", "bot-installed-2"];

afterAll(async () => {
  await db.delete(guilds).where(inArray(guilds.id, guildIds));
  await close();
});

beforeEach(async () => {
  await db.delete(guilds).where(inArray(guilds.id, guildIds));
  await db.insert(guilds).values([
    { id: "bot-installed-1", name: "bot導入済み1" },
    { id: "bot-installed-2", name: "bot導入済み2" },
  ]);
});

describe("isManagedGuild", () => {
  test("オーナーならtrue", () => {
    expect(isManagedGuild({ owner: true, permissions: "0" })).toBe(true);
  });

  test("MANAGE_GUILD(0x20)ビットを持てばtrue", () => {
    expect(isManagedGuild({ owner: false, permissions: String(0x20) })).toBe(true);
  });

  test("MANAGE_GUILDを含む複合ビットマスクでもtrue", () => {
    expect(isManagedGuild({ owner: false, permissions: String(0x20 | 0x8) })).toBe(true);
  });

  test("オーナーでもMANAGE_GUILDでもなければfalse", () => {
    expect(isManagedGuild({ owner: false, permissions: String(0x8) })).toBe(false);
  });

  test("permissionsが0ならfalse", () => {
    expect(isManagedGuild({ owner: false, permissions: "0" })).toBe(false);
  });
});

test("buildGuildIconUrlはアニメーションアイコンをGIFにし、未設定はnullにする", () => {
  expect(buildGuildIconUrl("g", "a_xyz")).toBe("https://cdn.discordapp.com/icons/g/a_xyz.gif?size=64");
  expect(buildGuildIconUrl("g", null)).toBeNull();
  expect(buildGuildIconUrl("g", undefined)).toBeNull();
});

describe("listMyGuilds", () => {
  test("bot導入済みのguildは管理者権限の有無を問わず返す(isManagedで区別)", async () => {
    const result = await listMyGuilds(db, [
      { id: "bot-installed-1", owner: true, permissions: "0", icon: "abc" },
      { id: "bot-installed-2", owner: false, permissions: "0" },
      { id: "not-installed", owner: false, permissions: "0" },
    ]);

    expect(result).toEqual(
      expect.arrayContaining([
        {
          id: "bot-installed-1",
          name: "bot導入済み1",
          isManaged: true,
          iconUrl: "https://cdn.discordapp.com/icons/bot-installed-1/abc.png?size=64",
        },
        { id: "bot-installed-2", name: "bot導入済み2", isManaged: false, iconUrl: null },
      ]),
    );
    expect(result).toHaveLength(2);
  });

  test("管理者権限を持っていてもbot未導入のguildは含めない", async () => {
    const result = await listMyGuilds(db, [{ id: "not-installed", owner: true, permissions: "0" }]);

    expect(result).toEqual([]);
  });

  test("所属guildが1件もなければDBに問い合わせず空配列を返す", async () => {
    const result = await listMyGuilds(db, []);

    expect(result).toEqual([]);
  });
});
