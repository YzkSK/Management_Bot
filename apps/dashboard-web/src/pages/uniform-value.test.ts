import { describe, expect, test } from "bun:test";
import { uniformValue } from "./uniform-value.js";

describe("uniformValue", () => {
  test("全て同じ値ならその値を返す", () => {
    expect(uniformValue([1, 1, 1])).toBe(1);
  });

  test("1つでも異なればundefined", () => {
    expect(uniformValue([1, 1, 2])).toBeUndefined();
  });

  test("要素が1つなら常にその値", () => {
    expect(uniformValue(["a"])).toBe("a");
  });

  test("空配列はundefined", () => {
    expect(uniformValue([])).toBeUndefined();
  });

  test("nullを含む配列も比較できる", () => {
    expect(uniformValue([null, null])).toBeNull();
    expect(uniformValue(["c1", null])).toBeUndefined();
  });
});
