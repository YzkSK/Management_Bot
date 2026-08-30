import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** `value.signature`形式のstateトークンを発行する。CSRF対策として認可URLへの遷移前にCookieへ保存する。 */
export function signState(sessionSecret: string): string {
  const value = randomBytes(16).toString("base64url");
  const signature = createHmac("sha256", sessionSecret).update(value).digest("base64url");
  return `${value}.${signature}`;
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

  const expected = createHmac("sha256", sessionSecret).update(value).digest("base64url");
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
}
