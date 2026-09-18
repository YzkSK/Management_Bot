import { describe, expect, test } from "bun:test";
import { toCompact } from "./text-normalization.js";

describe("toCompact", () => {
  test("全角文字はNFKCで半角化され、小文字化される", () => {
    expect(toCompact("ＢＡＤＷＯＲＤ")).toBe("badword");
  });

  test("ゼロ幅文字は除去される", () => {
    expect(toCompact("b​a‌d‍w﻿ord")).toBe("badword");
  });

  test("空白・句読点等の記号は除去される", () => {
    expect(toCompact("b.a.d.w.o.r.d")).toBe("badword");
    expect(toCompact("b a d word")).toBe("badword");
  });

  test("通常の英数字はそのまま保持される", () => {
    expect(toCompact("hello123")).toBe("hello123");
  });
});
