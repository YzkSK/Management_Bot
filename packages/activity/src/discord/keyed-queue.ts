/**
 * キーごとに非同期処理を直列化する。アクティブVC同期はhget→hsetの間に退室のhdelが割り込むと
 * 退室者を書き戻してしまうため、同じメンバーのイベントは到着順に1つずつ処理する。
 */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const result = prev.then(task, task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}
