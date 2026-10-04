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

  test("ホモグリフはラテン文字へ畳み込まれ、LEET記号は保持される", () => {
    expect(toCompact("bаdwоrd")).toBe("badword");
    expect(toCompact("b@d$!+|")).toBe("b@d$!+|");
  });

  test("日本語の仮名はラテン文字へ変換されない", () => {
    expect(toCompact("エロ")).toBe("エロ");
  });

  test("タブ・改行は除去される", () => {
    expect(toCompact("b\ta\rd\nword")).toBe("badword");
  });

  test("bidi制御文字などの書式文字(Cf)は除去される", () => {
    expect(toCompact("b⁠a‎d‮word")).toBe("badword");
  });
});
