import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { decryptToken, deriveSubkey, encryptToken } from "./token-crypto.js";

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

  test("#561以前の旧鍵(SESSION_SECRETのsha256)で暗号化された既存トークンも復号できる", () => {
    const secret = "a".repeat(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv);
    const ciphertext = Buffer.concat([cipher.update("legacy-token", "utf8"), cipher.final()]);
    const legacy = [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(":");

    expect(decryptToken(legacy, secret)).toBe("legacy-token");
  });

  test("用途ごとに異なる鍵を導出し、旧鍵(sha256)とも異なる", () => {
    const secret = "a".repeat(32);
    const tokenKey = deriveSubkey(secret, "token-encryption");
    expect(tokenKey.equals(deriveSubkey(secret, "oauth-state"))).toBe(false);
    expect(tokenKey.equals(createHash("sha256").update(secret).digest())).toBe(false);
  });

  test("throws on malformed input missing a segment", () => {
    expect(() => decryptToken("only-one-part", "a".repeat(32))).toThrow();
  });
});
