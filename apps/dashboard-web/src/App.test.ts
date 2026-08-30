import { describe, expect, test } from "bun:test";
import { TRPCClientError } from "@trpc/client";
import { isUnauthorizedError } from "./App.js";

describe("isUnauthorizedError", () => {
  test("TRPCのUNAUTHORIZEDエラーをtrueと判定する", () => {
    const error = TRPCClientError.from({
      error: { code: -32001, message: "unauthorized", data: { code: "UNAUTHORIZED" } },
    });

    expect(isUnauthorizedError(error)).toBe(true);
  });

  test("それ以外のTRPCエラー(例: INTERNAL_SERVER_ERROR)はfalseと判定する", () => {
    const error = TRPCClientError.from({
      error: { code: -32603, message: "boom", data: { code: "INTERNAL_SERVER_ERROR" } },
    });

    expect(isUnauthorizedError(error)).toBe(false);
  });

  test("ネットワークエラー等のTRPCClientError以外はfalseと判定する", () => {
    expect(isUnauthorizedError(new TypeError("Failed to fetch"))).toBe(false);
  });
});
