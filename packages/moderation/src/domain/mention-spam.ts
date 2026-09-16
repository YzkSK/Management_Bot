/** メッセージ本文中のuser/roleメンション数を数える(`<@id>`, `<@!id>`, `<@&id>`)。 */
const MENTION_PATTERN = /<@[!&]?\d+>/g;

export function countMentions(content: string): number {
  return content.match(MENTION_PATTERN)?.length ?? 0;
}

/** 1メッセージ内のメンション数が閾値以上ならヒットする単発判定。 */
export function hasSingleMessageMentionSpam(mentionCount: number, threshold: number): boolean {
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new RangeError(`threshold must be an integer >= 1, got ${threshold}`);
  }
  return mentionCount >= threshold;
}

/**
 * 直近ウィンドウ内(新規メッセージ自身を含む)の合計メンション数が閾値以上ならヒットする累積判定。
 * mentionCountsは同一ウィンドウ内の各メッセージのメンション数(hasFloodHitの時刻フィルタ後の
 * バッファに対応する呼び出し側で絞り込み済みの値)を渡す想定の純粋関数。
 */
export function hasCumulativeMentionSpam(mentionCounts: readonly number[], threshold: number): boolean {
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new RangeError(`threshold must be an integer >= 1, got ${threshold}`);
  }
  const total = mentionCounts.reduce((sum, count) => sum + count, 0);
  return total >= threshold;
}
