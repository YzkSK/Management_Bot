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

  constructor(private readonly scheduler: SettlementScheduler = globalThis) {}

  start(input: {
    key: string;
    initialMessageIds: readonly string[];
    maxAdditionalMessages: number;
  }): Promise<SettledBurst> {
    if (this.pending.has(input.key)) {
      throw new Error(`burst settlement is already pending: ${input.key}`);
    }

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

  private finish(key: string, reason: BurstSettlementReason): void {
    const pending = this.pending.get(key);
    if (!pending) return;

    this.pending.delete(key);
    this.scheduler.clearTimeout(pending.timer);
    pending.resolve({ messageIds: [...pending.messageIds], reason });
  }
}
