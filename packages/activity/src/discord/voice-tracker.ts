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

  /** 開いている区間をatまでで書き込み、atから計上を続ける(在室中の途中経過をDashboardへ反映するため)。 */
  async checkpoint(at: Date): Promise<void> {
    const deltas: HourlyDelta[] = [];
    for (const open of this.openSince.values()) {
      if (open.since >= at) continue;
      deltas.push(...toDeltas(open.guildId, open.userId, open.since, at));
      open.since = at;
    }
    if (deltas.length > 0) await this.write(deltas);
  }

  async closeAll(at: Date): Promise<void> {
    const entries = [...this.openSince.values()];
    this.openSince.clear();
    const deltas = entries.flatMap((e) => toDeltas(e.guildId, e.userId, e.since, at));
    if (deltas.length > 0) await this.write(deltas);
  }
}

function toDeltas(guildId: string, userId: string, start: Date, end: Date): HourlyDelta[] {
  return splitIntoHours(start, end).map(({ hour, seconds }) => ({
    guildId,
    userId,
    hour,
    messageCount: 0,
    voiceSeconds: seconds,
  }));
}
