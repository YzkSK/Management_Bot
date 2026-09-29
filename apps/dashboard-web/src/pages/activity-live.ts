import { z } from "zod";

const HOUR_MS = 3_600_000;
const JST_OFFSET_MS = 9 * HOUR_MS;
/** 発言が続いた時の再取得を間引く。 */
export const ACTIVITY_INVALIDATE_DELAY_MS = 250;

/** dashboard-apiのactivity-broadcasterが送るJSONメッセージの形。 */
const notificationSchema = z.object({ type: z.literal("activityChanged"), kind: z.enum(["stats", "voice"]) });

export function parseActivityNotification(data: string): "stats" | "voice" | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  const result = notificationSchema.safeParse(parsed);
  return result.success ? result.data.kind : null;
}

/** DBにはcheckpointまでの確定区間のみあるため、集計中メンバーの (現在 − countingSince) を画面側で足す。 */
export function liveVoiceSeconds(
  channels: readonly { members: readonly { userId: string; countingSince: string | null }[] }[],
  clock: Date,
): Map<string, number> {
  const live = new Map<string, number>();
  for (const channel of channels) {
    for (const m of channel.members) {
      if (m.countingSince === null) continue;
      live.set(m.userId, Math.max(0, Math.floor((clock.getTime() - Date.parse(m.countingSince)) / 1000)));
    }
  }
  return live;
}

export function sumLive(live: ReadonlyMap<string, number>): number {
  let sum = 0;
  for (const seconds of live.values()) sum += seconds;
  return sum;
}

/** ponytail: 進行中区間は全て現在のbucketへ寄せる(checkpointが60秒ごとなので時間境界をまたぐ誤差は最大60秒)。 */
export function currentBucket(clock: Date, granularity: "hour" | "day"): string {
  if (granularity === "hour") return new Date(Math.floor(clock.getTime() / HOUR_MS) * HOUR_MS).toISOString();
  return new Date(clock.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Asia/Tokyoの時(0-23)。メンバー詳細の時間帯別グラフへの加算用。 */
export function currentJstHour(clock: Date): number {
  return new Date(clock.getTime() + JST_OFFSET_MS).getUTCHours();
}

export function addToBucket<T extends { bucket: string; voiceSeconds: number }>(
  points: readonly T[],
  bucket: string,
  seconds: number,
  make: (bucket: string) => T,
): T[] {
  if (seconds === 0) return [...points];
  const base = points.some((p) => p.bucket === bucket) ? points : [...points, make(bucket)];
  return base.map((p) => (p.bucket === bucket ? { ...p, voiceSeconds: p.voiceSeconds + seconds } : p));
}
