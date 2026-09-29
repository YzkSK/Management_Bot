import type { HourlyDelta } from "../application/index.js";
import { splitIntoHours } from "../domain/index.js";

/**
 * ユーザーごとの「VC計上区間の開始時刻」をプロセス内メモリで持つ。
 * 区間が閉じたら時間単位に分割してwriteする。書き込み失敗時はその区間が失われる(呼び出し側でログ)。
 * ponytail: 単一プロセス前提。botを複数インスタンスで動かす場合は区間の保持先を共有ストアへ移す。
 */
export class VoiceTracker {
  private readonly openSince = new Map<string, { guildId: string; userId: string; since: Date }>();

  constructor(private readonly write: (deltas: HourlyDelta[]) => Promise<void>) {}

  async update(guildId: string, userId: string, counting: boolean, at: Date): Promise<void> {
    const key = `${guildId}:${userId}`;
    const open = this.openSince.get(key);
    if (counting) {
      if (!open) this.openSince.set(key, { guildId, userId, since: at });
      return;
    }
    if (!open) return;
    this.openSince.delete(key);
    await this.write(toDeltas(open.guildId, open.userId, open.since, at));
  }

  countingSince(guildId: string, userId: string): Date | undefined {
    return this.openSince.get(`${guildId}:${userId}`)?.since;
  }

  /**
   * 開いている区間をatまでで書き込み、atから計上を続ける(クラッシュ時の取りこぼし対策)。
   * 前進させた区間のキーを返す(アクティブVCのcountingSince更新用)。前進は書き込みより前に同期的に行う。
   */
  async checkpoint(at: Date): Promise<{ guildId: string; userId: string }[]> {
    const deltas: HourlyDelta[] = [];
    const advanced: { guildId: string; userId: string }[] = [];
    for (const open of this.openSince.values()) {
      if (open.since >= at) continue;
      deltas.push(...toDeltas(open.guildId, open.userId, open.since, at));
      open.since = at;
      advanced.push({ guildId: open.guildId, userId: open.userId });
    }
    if (deltas.length > 0) await this.write(deltas);
    return advanced;
  }

  async closeAll(at: Date): Promise<void> {
    const entries = [...this.openSince.values()];
    this.openSince.clear();
    const deltas = entries.flatMap((e) => toDeltas(e.guildId, e.userId, e.since, at));
    if (deltas.length > 0) await this.write(deltas);
  }
}

function toDeltas(guildId: string, userId: string, start: Date, end: Date): HourlyDelta[] {
  const parts = splitIntoHours(start, end);
  return parts.map(({ hour, seconds }, i) => ({
    guildId,
    userId,
    hour,
    messageCount: 0,
    voiceSeconds: seconds,
    ...(i === parts.length - 1 ? { lastVoiceAt: end } : {}),
  }));
}
