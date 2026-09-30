import { describe, expect, test } from "bun:test";
import { visiblePages } from "./pagination.js";

describe("visiblePages", () => {
  test("総ページ数が5以下なら全ページを返す", () => {
    expect(visiblePages(0, 3)).toEqual([0, 1, 2]);
  });

  test("0ページなら空", () => {
    expect(visiblePages(0, 0)).toEqual([]);
  });

  test("中央付近では現在ページを中心に5個返す", () => {
    expect(visiblePages(5, 10)).toEqual([3, 4, 5, 6, 7]);
  });

  test("先頭付近では先頭から5個返す", () => {
    expect(visiblePages(1, 10)).toEqual([0, 1, 2, 3, 4]);
  });

  test("末尾付近では末尾までの5個返す", () => {
    expect(visiblePages(9, 10)).toEqual([5, 6, 7, 8, 9]);
  });
});
