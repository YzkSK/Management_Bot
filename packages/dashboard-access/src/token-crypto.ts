import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function deriveKey(sessionSecret: string): Buffer {
  return createHash("sha256").update(sessionSecret).digest();
}

/** `iv:authTag:ciphertext`をbase64url結合した1文字列として返す。 */
export function encryptToken(plaintext: string, sessionSecret: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, deriveKey(sessionSecret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((part) => part.toString("base64url")).join(":");
}

export function decryptToken(encrypted: string, sessionSecret: string): string {
  const [ivPart, authTagPart, ciphertextPart] = encrypted.split(":");
  if (!ivPart || !authTagPart || !ciphertextPart) {
    throw new Error("Malformed encrypted token");
  }
  const decipher = createDecipheriv(ALGORITHM, deriveKey(sessionSecret), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(authTagPart, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
