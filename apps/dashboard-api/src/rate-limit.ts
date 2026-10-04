import type { MiddlewareHandler } from "hono";

/**
 * 固定ウィンドウのレート制限(issue #550)。キャッシュを通さずDiscord APIを叩く処理を連打されると
 * Botトークンのglobal rate limitを使い切り、Bot本体のモデレーションまで止まるため上限を設ける。
 * ponytail: プロセス内メモリで数える(dashboard-apiは単一プロセス)。複数レプリカ化したらRedisに移す。
 */
export function createRateLimiter({ limit, windowMs, now = Date.now }: { limit: number; windowMs: number; now?: () => number }) {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    /** 上限内ならtrue。期限切れのウィンドウは呼び出しのたびに掃除する(キー数は利用者数程度)。 */
    hit(key: string): boolean {
      const t = now();
      for (const [k, w] of windows) if (t - w.start >= windowMs) windows.delete(k);
      const current = windows.get(key);
      if (!current) {
        windows.set(key, { start: t, count: 1 });
        return true;
      }
      current.count++;
      return current.count <= limit;
    },
  };
}

/**
 * クライアントIP単位で数える。セッションCookieは検証前に使うと値を変えるだけで回避できるためキーにしない。
 * IPはCaddyが付けるX-Forwarded-Forの末尾(Caddyが直接見た接続元)を使い、クライアントが偽装した先頭側は使わない。
 */
function rateLimitKey(c: Parameters<MiddlewareHandler>[0]): string {
  return c.req.header("X-Forwarded-For")?.split(",").at(-1)?.trim() || "unknown";
}

export function rateLimit(limiter: ReturnType<typeof createRateLimiter>, filter?: (method: string) => boolean): MiddlewareHandler {
  return async (c, next) => {
    if (filter && !filter(c.req.method)) return next();
    if (!limiter.hit(rateLimitKey(c))) return c.text("Too Many Requests", 429);
    return next();
  };
}
