import { describe, expect, test } from "bun:test";
import { mapWithConcurrency } from "./concurrency.js";

describe("mapWithConcurrency", () => {
  test("全件処理し、fnの戻り値をvaluesと同じ順序で返す", async () => {
    const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, (n) => Promise.resolve(n * 10));
    expect(result).toEqual([10, 20, 30, 40, 50]);
  });

  test("同時実行数がlimitを超えない", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 1));
      concurrent--;
      return n;
    });

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  test("空配列は空配列を返す", async () => {
    const result = await mapWithConcurrency([], 3, (n: number) => Promise.resolve(n));
    expect(result).toEqual([]);
  });
});
