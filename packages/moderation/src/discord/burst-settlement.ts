export interface SettlementScheduler {
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

export type BurstSettlementReason = "quiet" | "limit";

export interface SettledBurst {
  messageIds: readonly string[];
  reason: BurstSettlementReason;
}

interface PendingBurst {
  messageIds: Set<string>;
  additionalMessageCount: number;
  maxAdditionalMessages: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: SettledBurst) => void;
}

const QUIET_PERIOD_MS = 1_000;

/** 同一投稿者の連投バーストが収束するまで、後続メッセージを短時間だけ収集する。 */
export class BurstSettlementCoordinator {
  private readonly pending = new Map<string, PendingBurst>();
  /**
   * 件数上限で先行バッチを削除した直後も、同じ連投が続く場合がある。strike lock中は
   * 新たな検知結果が返らないため、この短い猶予中の投稿は呼び出し側で個別削除する。
   */
  private readonly postLimitDrains = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly scheduler: SettlementScheduler = globalThis) {}

  start(input: {
    key: string;
    initialMessageIds: readonly string[];
    maxAdditionalMessages: number;
  }): Promise<SettledBurst> {
    if (this.pending.has(input.key)) {
      throw new Error(`burst settlement is already pending: ${input.key}`);
    }

    this.clearPostLimitDrain(input.key);

    return new Promise((resolve) => {
      const timer = this.scheduler.setTimeout(() => this.finish(input.key, "quiet"), QUIET_PERIOD_MS);
      this.pending.set(input.key, {
        messageIds: new Set(input.initialMessageIds),
        additionalMessageCount: 0,
        maxAdditionalMessages: input.maxAdditionalMessages,
        timer,
        resolve,
      });
    });
  }

  append(key: string, messageId: string): boolean {
    const pending = this.pending.get(key);
    if (!pending) return false;

    if (!pending.messageIds.has(messageId)) {
      pending.messageIds.add(messageId);
      pending.additionalMessageCount += 1;
    }
    this.scheduler.clearTimeout(pending.timer);
    if (pending.additionalMessageCount >= pending.maxAdditionalMessages) {
      this.finish(key, "limit");
    } else {
      pending.timer = this.scheduler.setTimeout(() => this.finish(key, "quiet"), QUIET_PERIOD_MS);
    }
    return true;
  }

  /**
   * 上限到達で収束した直後に続く投稿ならtrueを返す。無投稿期間が続けば自動的に解除されるため、
   * 以降の通常投稿を削除し続けることはない。
   */
  consumePostLimitDrain(key: string): boolean {
    const timer = this.postLimitDrains.get(key);
    if (!timer) return false;

    this.scheduler.clearTimeout(timer);
    this.postLimitDrains.set(key, this.scheduler.setTimeout(() => this.clearPostLimitDrain(key), QUIET_PERIOD_MS));
    return true;
  }

  private finish(key: string, reason: BurstSettlementReason): void {
    const pending = this.pending.get(key);
    if (!pending) return;

    this.pending.delete(key);
    this.scheduler.clearTimeout(pending.timer);
    if (reason === "limit") {
      this.clearPostLimitDrain(key);
      this.postLimitDrains.set(key, this.scheduler.setTimeout(() => this.clearPostLimitDrain(key), QUIET_PERIOD_MS));
    }
    pending.resolve({ messageIds: [...pending.messageIds], reason });
  }

  private clearPostLimitDrain(key: string): void {
    const timer = this.postLimitDrains.get(key);
    if (timer) this.scheduler.clearTimeout(timer);
    this.postLimitDrains.delete(key);
  }
}
