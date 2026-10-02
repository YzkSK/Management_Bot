/** 実行中のDB書き込みを追跡し、停止時にすべての完了を待てるようにする(DBを閉じる前に書き込みを失わないため)。 */
export class InFlightWrites {
  private readonly pending = new Set<Promise<unknown>>();

  track<T>(promise: Promise<T>): Promise<T> {
    const settled = promise.then(
      () => undefined,
      () => undefined,
    );
    this.pending.add(settled);
    void settled.then(() => this.pending.delete(settled));
    return promise;
  }

  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.all(this.pending);
  }
}
