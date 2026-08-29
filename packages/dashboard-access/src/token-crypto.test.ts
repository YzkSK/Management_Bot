import { describe, expect, test } from "bun:test";
import { decryptToken, encryptToken } from "./token-crypto.js";

describe("token-crypto", () => {
  test("round-trips plaintext through encrypt/decrypt", () => {
    const secret = "a".repeat(32);
    const encrypted = encryptToken("discord-access-token", secret);
    expect(encrypted).not.toContain("discord-access-token");
    expect(decryptToken(encrypted, secret)).toBe("discord-access-token");
  });

  test("fails to decrypt with the wrong secret", () => {
    const encrypted = encryptToken("secret-value", "a".repeat(32));
    expect(() => decryptToken(encrypted, "b".repeat(32))).toThrow();
  });

  test("fails to decrypt a tampered ciphertext (auth tag mismatch)", () => {
    const secret = "a".repeat(32);
    const encrypted = encryptToken("secret-value", secret);
    const [iv, authTag, ciphertext] = encrypted.split(":");
    const tampered = `${iv}:${authTag}:${ciphertext}AA`;
    expect(() => decryptToken(tampered, secret)).toThrow();
  });

  test("throws on malformed input missing a segment", () => {
    expect(() => decryptToken("only-one-part", "a".repeat(32))).toThrow();
  });
});
