import { describe, expect, test } from "bun:test";
import { LOG_CATEGORIES } from "@management-bot/shared";
import { mapAllLogCategories, valuesForAllLogCategories } from "./per-category-settings.js";

describe("mapAllLogCategories", () => {
  test("LOG_CATEGORIESの順で全カテゴリ分を返し、行のないカテゴリにはundefinedを渡す", () => {
    const [first, second] = LOG_CATEGORIES;
    const rows = [{ category: second, value: 2 }];
    const result = mapAllLogCategories(rows, (category, row) => ({ category, value: row?.value ?? 0 }));

    expect(result.map((setting) => setting.category)).toEqual([...LOG_CATEGORIES]);
    expect(result[0]).toEqual({ category: first, value: 0 });
    expect(result[1]).toEqual({ category: second, value: 2 });
  });
});

describe("valuesForAllLogCategories", () => {
  test("全カテゴリ分のinsert行を同じ値で作る", () => {
    const rows = valuesForAllLogCategories("guild-1", { retentionDays: 30 });

    expect(rows).toEqual(LOG_CATEGORIES.map((category) => ({ guildId: "guild-1", category, retentionDays: 30 })));
  });
});
