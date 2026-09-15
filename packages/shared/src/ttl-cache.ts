export interface TtlCache<T> {
  (key: string, load: () => Promise<T>): Promise<T>;
  /** TTL内にある値をloaderを実行せず取得する。 */
  peek(key: string): Promise<T> | undefined;
  /** 取得済みの値をTTLキャッシュへ登録する。 */
  set(key: string, value: T): void;
  /** keyのエントリを即座に破棄する。次回呼び出しはTTL満了を待たずloadし直す。 */
  invalidate(key: string): void;
}

/**
 * key単位の短命TTLキャッシュ。in-flightなPromiseも共有するため、同時多発呼び出しが
 * 同一APIを重複fetchしない(issue #99: Discord API問い合わせの重複によるDashboard表示遅延)。
 * TTL経過時にsetTimeoutで確実にエントリを破棄する(ランダムなキーが使い回されず、
 * Mapがプロセス生存期間中増え続けないようにするため)。
 */
export function createTtlCache<T>(ttlMs: number, now: () => number = Date.now): TtlCache<T> {
  const entries = new Map<string, { expiresAt: number; value: Promise<T> }>();

  const setEntry = (key: string, value: Promise<T>): void => {
    entries.set(key, { expiresAt: now() + ttlMs, value });

    const deleteIfCurrent = (): void => {
      if (entries.get(key)?.value === value) {
        entries.delete(key);
      }
    };
    value.catch(deleteIfCurrent);
    setTimeout(deleteIfCurrent, ttlMs).unref?.();
  };

  const cache = ((key, load) => {
    const nowMs = now();
    const entry = entries.get(key);
    if (entry && entry.expiresAt > nowMs) {
      return entry.value;
    }

    const value = load();
    setEntry(key, value);

    return value;
  }) as TtlCache<T>;

  cache.peek = (key) => {
    const entry = entries.get(key);
    return entry && entry.expiresAt > now() ? entry.value : undefined;
  };
  cache.set = (key, value) => setEntry(key, Promise.resolve(value));
  cache.invalidate = (key) => entries.delete(key);

  return cache;
}
