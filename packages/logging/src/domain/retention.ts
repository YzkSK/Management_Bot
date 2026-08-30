/**
 * retentionDays: ギルド・カテゴリごとの保持期間(日数)。
 * 0は「無期限保存」を意味し、削除/アーカイブ対象には絶対にならない。
 * 負値・非整数は不正な設定として例外を投げる(呼び出し側でDB保存前にバリデーションする想定)。
 */
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function assertValidRetentionDays(retentionDays: number): void {
  if (!Number.isInteger(retentionDays) || retentionDays < 0) {
    throw new RangeError(`retentionDays must be a non-negative integer, got ${retentionDays}`);
  }
}

function assertValidDate(value: Date, name: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new RangeError(`${name} must be a valid Date`);
  }
}

/**
 * createdAtが保持期間を過ぎているか(削除/アーカイブ対象か)を判定する純粋関数。
 * retentionDays=0は無期限保存として常にfalseを返す。nowは呼び出し側が明示的に渡すこと。
 */
export function isExpired(retentionDays: number, createdAt: Date, now: Date): boolean {
  assertValidRetentionDays(retentionDays);
  assertValidDate(createdAt, "createdAt");
  assertValidDate(now, "now");
  if (retentionDays === 0) {
    return false;
  }
  return now.getTime() - createdAt.getTime() >= retentionDays * MILLISECONDS_PER_DAY;
}
