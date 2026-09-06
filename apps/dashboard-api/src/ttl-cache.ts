/**
 * key単位の短命TTLキャッシュ。in-flightなPromiseも共有するため、同時多発呼び出しが
 * 同一APIを重複fetchしない(issue #99: Discord API問い合わせの重複によるDashboard表示遅延)。
 */
export function createTtlCache<T>(ttlMs: number): (key: string, load: () => Promise<T>) => Promise<T> {
  const entries = new Map<string, { expiresAt: number; value: Promise<T> }>();

  return (key, load) => {
    const now = Date.now();
    const entry = entries.get(key);
    if (entry && entry.expiresAt > now) {
      return entry.value;
    }

    const value = load();
    entries.set(key, { expiresAt: now + ttlMs, value });
    value.catch(() => entries.delete(key));
    return value;
  };
}
