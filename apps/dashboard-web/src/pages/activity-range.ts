export type ActivityPeriod = "24h" | "7d" | "30d" | "90d";

export const ACTIVITY_PERIODS: readonly { value: ActivityPeriod; label: string }[] = [
  { value: "24h", label: "24時間" },
  { value: "7d", label: "7日" },
  { value: "30d", label: "30日" },
  { value: "90d", label: "90日" },
];

export interface ActivityRange {
  from: string;
  to: string;
  granularity: "hour" | "day";
}

export interface ActivitySeriesPoint {
  bucket: string;
  messageCount: number;
  voiceSeconds: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const JST_OFFSET_MS = 9 * HOUR_MS;
const PERIOD_MS: Record<ActivityPeriod, number> = { "24h": DAY_MS, "7d": 7 * DAY_MS, "30d": 30 * DAY_MS, "90d": 90 * DAY_MS };

export function toRange(period: ActivityPeriod, now: Date): ActivityRange {
  return {
    from: new Date(now.getTime() - PERIOD_MS[period]).toISOString(),
    to: now.toISOString(),
    granularity: period === "24h" ? "hour" : "day",
  };
}

function toJstDay(ms: number): string {
  return new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** APIが返さない(活動0の)bucketを0で補完する。日別はJSTの日付、時間別はUTCの時間先頭。 */
export function fillSeries(series: readonly ActivitySeriesPoint[], range: ActivityRange): ActivitySeriesPoint[] {
  const byBucket = new Map(series.map((p) => [p.bucket, p]));
  const fromMs = Date.parse(range.from);
  const toMs = Date.parse(range.to);
  const buckets: string[] = [];
  if (range.granularity === "hour") {
    for (let ms = Math.floor(fromMs / HOUR_MS) * HOUR_MS; ms < toMs; ms += HOUR_MS) buckets.push(new Date(ms).toISOString());
  } else {
    const lastDay = toJstDay(toMs - 1);
    for (let ms = fromMs; ; ms += DAY_MS) {
      const day = toJstDay(ms);
      buckets.push(day);
      if (day >= lastDay) break;
    }
  }
  return buckets.map((bucket) => byBucket.get(bucket) ?? { bucket, messageCount: 0, voiceSeconds: 0 });
}

/** 秒数を "14h 20m" / "20m" の形にする(`/activity me` と同じ表記)。 */
export function formatDuration(seconds: number): string {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** グラフ・一覧の軸ラベル。日別は MM/DD、時間別はJSTの "HH時"。 */
export function formatBucketLabel(bucket: string, granularity: "hour" | "day"): string {
  if (granularity === "day") return bucket.slice(5).replace("-", "/");
  return `${new Date(Date.parse(bucket) + JST_OFFSET_MS).getUTCHours()}時`;
}

/** 最終活動時刻の相対表示("5分前" / "3時間前" / "2日前")。 */
export function formatRelative(iso: string | null, now: Date): string {
  if (iso === null) return "-";
  const diffMs = Math.max(0, now.getTime() - Date.parse(iso));
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / 60_000)}分前`;
  if (diffMs < DAY_MS) return `${Math.floor(diffMs / HOUR_MS)}時間前`;
  return `${Math.floor(diffMs / DAY_MS)}日前`;
}
