import { type HourlyDelta, laterOf } from "../application/index.js";
import { hourStart } from "../domain/index.js";

/** 発言数を(guild,user,hour)ごとにメモリで数え、flushでまとめて書く。書き込み失敗時は次回へ持ち越す。 */
export class MessageCounter {
  private pending = new Map<string, HourlyDelta>();

  constructor(private readonly write: (deltas: HourlyDelta[]) => Promise<void>) {}

  record(guildId: string, userId: string, at: Date): void {
    const hour = hourStart(at);
    const key = `${guildId}:${userId}:${hour.getTime()}`;
    const prev = this.pending.get(key);
    this.pending.set(key, {
      guildId,
      userId,
      hour,
      messageCount: (prev?.messageCount ?? 0) + 1,
      voiceSeconds: 0,
      lastMessageAt: laterOf(prev?.lastMessageAt, at),
    });
  }

  async flush(): Promise<void> {
    if (this.pending.size === 0) return;
    const batch = this.pending;
    this.pending = new Map();
    try {
      await this.write([...batch.values()]);
    } catch (error) {
      for (const [key, delta] of batch) {
        const now = this.pending.get(key);
        this.pending.set(
          key,
          now
            ? {
                ...now,
                messageCount: now.messageCount + delta.messageCount,
                lastMessageAt: laterOf(now.lastMessageAt, delta.lastMessageAt),
              }
            : delta,
        );
      }
      throw error;
    }
  }
}
