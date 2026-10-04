import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * state署名にはトークン暗号化(dashboard-accessのderiveSubkey "token-encryption")と別の、
 * HKDFで導出した専用鍵を使う(issue #561)。
 */
const sign = (value: string, sessionSecret: string): string =>
  createHmac("sha256", Buffer.from(hkdfSync("sha256", sessionSecret, "", "management-bot:oauth-state", 32)))
    .update(value)
    .digest("base64url");

/** `value.signature`形式のstateトークンを発行する。CSRF対策として認可URLへの遷移前にCookieへ保存する。 */
export function signState(sessionSecret: string): string {
  const value = randomBytes(16).toString("base64url");
  return `${value}.${sign(value, sessionSecret)}`;
}

export function verifyState(
  stateFromCallback: string | undefined,
  stateFromCookie: string | undefined,
  sessionSecret: string,
): boolean {
  if (!stateFromCallback || !stateFromCookie || stateFromCallback !== stateFromCookie) {
    return false;
  }
  const [value, signature] = stateFromCookie.split(".");
  if (!value || !signature) return false;

  const expectedBuf = Buffer.from(sign(value, sessionSecret));
  const actualBuf = Buffer.from(signature);
  return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
}
