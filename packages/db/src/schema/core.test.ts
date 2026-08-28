import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("初回マイグレーション", () => {
  test("guild_feature_toggles.feature_keyがfeatures.keyへのFK制約を持つ", () => {
    const sql = readFileSync(
      join(import.meta.dirname, "../../drizzle/0000_dear_texas_twister.sql"),
      "utf-8",
    );

    expect(sql).toMatch(
      /ALTER TABLE "guild_feature_toggles" ADD CONSTRAINT .* FOREIGN KEY \("feature_key"\) REFERENCES "public"\."features"\("key"\)/,
    );
  });
});
