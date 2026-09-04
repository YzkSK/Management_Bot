import { describe, expect, test } from "bun:test";
import { INITIAL_PAGINATION, currentCursor, goNextPage, goPrevPage } from "./pagination.js";

describe("pagination", () => {
  test("初期状態はカーソルundefinedの1ページ目", () => {
    expect(currentCursor(INITIAL_PAGINATION)).toBeUndefined();
  });

  test("nextCursorがnullなら次へ進まない", () => {
    const next = goNextPage(INITIAL_PAGINATION, null);
    expect(next).toEqual(INITIAL_PAGINATION);
  });

  test("次へ進むとnextCursorが現在のカーソルになる", () => {
    const next = goNextPage(INITIAL_PAGINATION, "cursor-1");
    expect(currentCursor(next)).toBe("cursor-1");
  });

  test("前へ戻ると直前のカーソルに戻る", () => {
    const next = goNextPage(INITIAL_PAGINATION, "cursor-1");
    const prev = goPrevPage(next);
    expect(currentCursor(prev)).toBeUndefined();
  });

  test("1ページ目で前へ戻っても変化しない", () => {
    expect(goPrevPage(INITIAL_PAGINATION)).toEqual(INITIAL_PAGINATION);
  });

  test("既に訪れたページへ再度次へ進んでもカーソル履歴は増えない", () => {
    const next = goNextPage(INITIAL_PAGINATION, "cursor-1");
    const prev = goPrevPage(next);
    const nextAgain = goNextPage(prev, "cursor-1-different");
    expect(currentCursor(nextAgain)).toBe("cursor-1");
    expect(nextAgain.cursors).toHaveLength(2);
  });
});
