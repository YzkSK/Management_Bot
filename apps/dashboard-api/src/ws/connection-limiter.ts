/** WebSocket接続数をユーザー単位・全体で制限する(issue #559)。1つのセッションから無制限に接続されメモリが枯渇するのを防ぐ。 */
export function createConnectionLimiter(limits: { perUser: number; total: number }) {
  const perUser = new Map<string, number>();
  let total = 0;
  return {
    tryAcquire(userId: string): boolean {
      const current = perUser.get(userId) ?? 0;
      if (current >= limits.perUser || total >= limits.total) return false;
      perUser.set(userId, current + 1);
      total++;
      return true;
    },
    release(userId: string): void {
      const current = perUser.get(userId) ?? 0;
      if (current <= 0) return;
      if (current === 1) perUser.delete(userId);
      else perUser.set(userId, current - 1);
      total--;
    },
  };
}
