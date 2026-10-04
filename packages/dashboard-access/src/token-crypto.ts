import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/**
 * SESSION_SECRETからHKDFで用途別の鍵を導出する(issue #561)。同じシークレットを複数用途(トークン暗号化・
 * OAuth state署名)にそのまま使わず、infoで用途を分けて鍵を分離する。
 */
export function deriveSubkey(sessionSecret: string, purpose: "token-encryption" | "oauth-state"): Buffer {
  // "oauth-state"はdashboard-apiのoauth/state.tsで同じinfoを使って導出している。
  return Buffer.from(hkdfSync("sha256", sessionSecret, "", `management-bot:${purpose}`, 32));
}

/**
 * #561以前の鍵(SESSION_SECRETのsha256)。既存セッションの暗号化トークンを復号するためだけに残す。
 * ponytail: 旧鍵で暗号化された行はセッション期限切れで消えるため、最長セッション期間が過ぎたら削除してよい。
 */
function legacyKey(sessionSecret: string): Buffer {
  return createHash("sha256").update(sessionSecret).digest();
}

/** `iv:authTag:ciphertext`をbase64url結合した1文字列として返す。 */
export function encryptToken(plaintext: string, sessionSecret: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, deriveSubkey(sessionSecret, "token-encryption"), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((part) => part.toString("base64url")).join(":");
}

function decryptWithKey(ivPart: string, authTagPart: string, ciphertextPart: string, key: Buffer): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(authTagPart, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextPart, "base64url")), decipher.final()]);
  return plaintext.toString("utf8");
}

/** 新しい鍵で復号し、認証に失敗した場合のみ#561以前の旧鍵でフォールバックする(既存セッションを壊さないため)。 */
export function decryptToken(encrypted: string, sessionSecret: string): string {
  const [ivPart, authTagPart, ciphertextPart] = encrypted.split(":");
  if (!ivPart || !authTagPart || !ciphertextPart) {
    throw new Error("Malformed encrypted token");
  }
  try {
    return decryptWithKey(ivPart, authTagPart, ciphertextPart, deriveSubkey(sessionSecret, "token-encryption"));
  } catch {
    return decryptWithKey(ivPart, authTagPart, ciphertextPart, legacyKey(sessionSecret));
  }
}
