import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, guilds } from "@management-bot/db";
import { inArray } from "drizzle-orm";
import { isManagedGuild, listMyGuilds } from "./list-my-guilds.js";

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

describe("listMyGuilds", () => {
  test("bot導入済みかつ管理者権限を持つguildのみ返す", async () => {
    const result = await listMyGuilds(db, [
      { id: "bot-installed-1", owner: true, permissions: "0" },
      { id: "not-managed", owner: false, permissions: "0" },
    ]);

    expect(result).toEqual([{ id: "bot-installed-1", name: "bot導入済み1" }]);
  });

  test("管理者権限を持っていてもbot未導入のguildは含めない", async () => {
    const result = await listMyGuilds(db, [{ id: "not-installed", owner: true, permissions: "0" }]);

    expect(result).toEqual([]);
  });

  test("管理者権限を持つguildが1件もなければDBに問い合わせず空配列を返す", async () => {
    const result = await listMyGuilds(db, [{ id: "bot-installed-1", owner: false, permissions: "0" }]);

    expect(result).toEqual([]);
  });
});
