import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, type Db, guilds } from "@management-bot/db";
import { eq } from "drizzle-orm";
import { addNgword, listNgwords, removeNgword, UnsafeNgwordRegexError } from "./ngwords.js";

describe("ngwords application", () => {
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

  test("addNgword/listNgwordsでexact/contains/regexを登録・一覧取得できる", async () => {
    await addNgword(db, guildId, "exact", "ng1");
    await addNgword(db, guildId, "contains", "ng2");
    await addNgword(db, guildId, "regex", "^ng3\\d+$");

    const rows = await listNgwords(db, guildId);
    expect(rows.map((r) => r.pattern).sort()).toEqual(["^ng3\\d+$", "ng1", "ng2"]);
  });

  test("危険な正規表現(ネストした量指定子)の登録はUnsafeNgwordRegexErrorで拒否される", async () => {
    await expect(addNgword(db, guildId, "regex", "(a+)+")).rejects.toThrow(UnsafeNgwordRegexError);
  });

  test("removeNgwordで削除でき、未登録のidでもエラーにならない", async () => {
    const row = await addNgword(db, guildId, "exact", "to-remove");
    await removeNgword(db, guildId, row.id);
    const rows = await listNgwords(db, guildId);
    expect(rows.find((r) => r.id === row.id)).toBeUndefined();

    await removeNgword(db, guildId, randomUUID());
  });
});
