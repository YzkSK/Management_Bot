/**
 * key単位の短命TTLキャッシュ。in-flightなPromiseも共有するため、同時多発呼び出しが
 * 同一APIを重複fetchしない(issue #99: Discord API問い合わせの重複によるDashboard表示遅延)。
 * TTL経過時にsetTimeoutで確実にエントリを破棄する(ランダムなキーが使い回されず、
 * Mapがプロセス生存期間中増え続けないようにするため)。
 */
export function createTtlCache<T>(
  ttlMs: number,
  now: () => number = Date.now,
): (key: string, load: () => Promise<T>) => Promise<T> {
  const entries = new Map<string, { expiresAt: number; value: Promise<T> }>();

  return (key, load) => {
    const nowMs = now();
    const entry = entries.get(key);
    if (entry && entry.expiresAt > nowMs) {
      return entry.value;
    }

    const value = load();
    entries.set(key, { expiresAt: nowMs + ttlMs, value });

    const deleteIfCurrent = (): void => {
      if (entries.get(key)?.value === value) {
        entries.delete(key);
      }
    };
    value.catch(deleteIfCurrent);
    setTimeout(deleteIfCurrent, ttlMs).unref?.();

    return value;
  };
}
