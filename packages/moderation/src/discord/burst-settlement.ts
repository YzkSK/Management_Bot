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
  postLimitCaseId?: string;
}

interface PostLimitArm {
  caseId: string;
  maxAdditionalMessages: number;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingPostLimitDrain {
  messageIds: Set<string>;
  additionalMessageCount: number;
  maxAdditionalMessages: number;
  caseId: string;
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: SettledPostLimitBurst) => void;
}

export interface SettledPostLimitBurst extends SettledBurst {
  caseId: string;
}

export type PostLimitDrainAppend =
  | { role: "leader"; settled: Promise<SettledPostLimitBurst> }
  | { role: "follower" }
  | undefined;

const QUIET_PERIOD_MS = 1_000;

/** 同一投稿者の連投バーストが収束するまで、後続メッセージを短時間だけ収集する。 */
export class BurstSettlementCoordinator {
  private readonly pending = new Map<string, PendingBurst>();
  /**
   * 件数上限で先行バッチを削除した直後も、同じ連投が続く場合がある。strike lock中は
   * 新たな検知結果が返らないため、短い猶予中の投稿を次の一括削除として収集する。
   */
  private readonly postLimitArms = new Map<string, PostLimitArm>();
  private readonly pendingPostLimitDrains = new Map<string, PendingPostLimitDrain>();

  constructor(private readonly scheduler: SettlementScheduler = globalThis) {}

  start(input: {
    key: string;
    initialMessageIds: readonly string[];
    maxAdditionalMessages: number;
    postLimitCaseId?: string;
  }): Promise<SettledBurst> {
    if (this.pending.has(input.key)) {
      throw new Error(`burst settlement is already pending: ${input.key}`);
    }

    this.clearPostLimitArm(input.key);

    return new Promise((resolve) => {
      const timer = this.scheduler.setTimeout(() => this.finish(input.key, "quiet"), QUIET_PERIOD_MS);
      this.pending.set(input.key, {
        messageIds: new Set(input.initialMessageIds),
        additionalMessageCount: 0,
        maxAdditionalMessages: input.maxAdditionalMessages,
        timer,
        resolve,
        ...(input.postLimitCaseId === undefined ? {} : { postLimitCaseId: input.postLimitCaseId }),
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
   * 上限到達後の追加投稿を次の削除バッチとして収集する。最初の投稿だけがleaderとなり、
   * 収束後に呼び出し側で一括削除を実行する。後続投稿はfollowerとして同じバッチに加わる。
   */
  appendPostLimitDrain(key: string, messageId: string): PostLimitDrainAppend {
    const pending = this.pendingPostLimitDrains.get(key);
    if (pending) {
      this.appendToPostLimitDrain(key, pending, messageId);
      return { role: "follower" };
    }

    const arm = this.postLimitArms.get(key);
    if (!arm) return undefined;

    this.clearPostLimitArm(key);
    let resolve!: (result: SettledPostLimitBurst) => void;
    const settled = new Promise<SettledPostLimitBurst>((resolvePromise) => {
      resolve = resolvePromise;
    });
    const drain: PendingPostLimitDrain = {
      messageIds: new Set([messageId]),
      additionalMessageCount: 1,
      maxAdditionalMessages: arm.maxAdditionalMessages,
      caseId: arm.caseId,
      timer: this.scheduler.setTimeout(() => this.finishPostLimitDrain(key, "quiet"), QUIET_PERIOD_MS),
      resolve,
    };
    this.pendingPostLimitDrains.set(key, drain);
    if (drain.additionalMessageCount >= drain.maxAdditionalMessages) this.finishPostLimitDrain(key, "limit");
    return { role: "leader", settled };
  }

  private finish(key: string, reason: BurstSettlementReason): void {
    const pending = this.pending.get(key);
    if (!pending) return;

    this.pending.delete(key);
    this.scheduler.clearTimeout(pending.timer);
    if (reason === "limit" && pending.postLimitCaseId) this.armPostLimitDrain(key, pending);
    pending.resolve({ messageIds: [...pending.messageIds], reason });
  }

  private armPostLimitDrain(key: string, pending: PendingBurst): void {
    this.clearPostLimitArm(key);
    const timer = this.scheduler.setTimeout(() => this.clearPostLimitArm(key), QUIET_PERIOD_MS);
    this.postLimitArms.set(key, {
      caseId: pending.postLimitCaseId!,
      maxAdditionalMessages: pending.maxAdditionalMessages,
      timer,
    });
  }

  private appendToPostLimitDrain(key: string, pending: PendingPostLimitDrain, messageId: string): void {
    if (!pending.messageIds.has(messageId)) {
      pending.messageIds.add(messageId);
      pending.additionalMessageCount += 1;
    }
    this.scheduler.clearTimeout(pending.timer);
    if (pending.additionalMessageCount >= pending.maxAdditionalMessages) {
      this.finishPostLimitDrain(key, "limit");
    } else {
      pending.timer = this.scheduler.setTimeout(() => this.finishPostLimitDrain(key, "quiet"), QUIET_PERIOD_MS);
    }
  }

  private finishPostLimitDrain(key: string, reason: BurstSettlementReason): void {
    const pending = this.pendingPostLimitDrains.get(key);
    if (!pending) return;

    this.pendingPostLimitDrains.delete(key);
    this.scheduler.clearTimeout(pending.timer);
    pending.resolve({ messageIds: [...pending.messageIds], reason, caseId: pending.caseId });
  }

  private clearPostLimitArm(key: string): void {
    const arm = this.postLimitArms.get(key);
    const timer = arm?.timer;
    if (timer) this.scheduler.clearTimeout(timer);
    this.postLimitArms.delete(key);
  }
}
