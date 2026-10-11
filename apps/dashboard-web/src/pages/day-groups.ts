const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function dayOffset(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

export interface DayHeading {
  key: string;
  /** 「昨日」「今日」「明日」。それ以外はnull。 */
  relative: string | null;
  /** 「10月12日(月)」形式(別の年は年も付ける)。 */
  date: string;
}

export function formatDayHeading(value: string | Date, now: Date = new Date()): DayHeading {
  const date = new Date(value);
  const key = dayKey(date);
  const relative =
    key === dayKey(now)
      ? "今日"
      : key === dayKey(dayOffset(now, -1))
        ? "昨日"
        : key === dayKey(dayOffset(now, 1))
          ? "明日"
          : null;
  const year = date.getFullYear() === now.getFullYear() ? "" : `${date.getFullYear()}年`;
  return { key, relative, date: `${year}${date.getMonth() + 1}月${date.getDate()}日(${WEEKDAYS[date.getDay()]})` };
}

/** 並んだ順のまま、連続する同じ日付ごとにまとめる(並べ替えは呼び出し側で済ませる)。 */
export function groupByDay<T>(
  items: readonly T[],
  getDate: (item: T) => string | Date,
  now: Date = new Date(),
): (DayHeading & { items: T[] })[] {
  const groups: (DayHeading & { items: T[] })[] = [];
  for (const item of items) {
    const heading = formatDayHeading(getDate(item), now);
    const last = groups.at(-1);
    if (last && last.key === heading.key) last.items.push(item);
    else groups.push({ ...heading, items: [item] });
  }
  return groups;
}

export function formatTime(value: string | Date): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
