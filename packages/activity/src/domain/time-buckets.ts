const HOUR_MS = 3_600_000;
const JST_OFFSET_MS = 9 * HOUR_MS;

export function hourStart(at: Date): Date {
  return new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS);
}

/** [start, end) を UTC の時間境界で分割し、各時間の秒数(秒境界で切り捨て)を返す。0秒のバケットは除く。 */
export function splitIntoHours(start: Date, end: Date): { hour: Date; seconds: number }[] {
  const buckets: { hour: Date; seconds: number }[] = [];
  let cursor = start.getTime();
  const endMs = end.getTime();
  while (cursor < endMs) {
    const bucketStart = Math.floor(cursor / HOUR_MS) * HOUR_MS;
    const bucketEnd = Math.min(bucketStart + HOUR_MS, endMs);
    const seconds = Math.floor(bucketEnd / 1000) - Math.floor(cursor / 1000);
    if (seconds > 0) buckets.push({ hour: new Date(bucketStart), seconds });
    cursor = bucketEnd;
  }
  return buckets;
}

/** Asia/Tokyo(固定+9h、DSTなし)の日付を YYYY-MM-DD で返す。 */
export function toJstDay(at: Date): string {
  return new Date(at.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}
