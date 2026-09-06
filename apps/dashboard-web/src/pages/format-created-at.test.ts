import { describe, expect, test } from "bun:test";
import { formatCreatedAt } from "./format-created-at.js";

describe("formatCreatedAt", () => {
  test("ISO日時をja-JP形式の文字列に整形する", () => {
    const formatted = formatCreatedAt("2026-09-04T00:00:00.000Z");
    expect(typeof formatted).toBe("string");
    expect(formatted).toContain("2026");
  });
});
