import { describe, expect, test } from "bun:test";
import { signState, verifyState } from "./state.js";

describe("oauth state", () => {
  test("verifies a state signed with the same secret", () => {
    const secret = "a".repeat(32);
    const state = signState(secret);
    expect(verifyState(state, state, secret)).toBe(true);
  });

  test("rejects mismatched callback/cookie state", () => {
    const secret = "a".repeat(32);
    const state = signState(secret);
    expect(verifyState(state, signState(secret), secret)).toBe(false);
  });

  test("rejects a state signed with a different secret", () => {
    const state = signState("a".repeat(32));
    expect(verifyState(state, state, "b".repeat(32))).toBe(false);
  });

  test("rejects missing values", () => {
    expect(verifyState(undefined, "x", "a".repeat(32))).toBe(false);
    expect(verifyState("x", undefined, "a".repeat(32))).toBe(false);
  });
});
