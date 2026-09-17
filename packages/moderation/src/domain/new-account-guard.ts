const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * アカウント作成日(createdAt)からjoinedAt時点でmaxAgeDays日以内かどうかを判定する純粋関数。
 * レイド判定の新規アカウント比率算出(raid.ts)とnew_account_guard単体判定(#193設計spec)の
 * 両方から使われる共通ロジック。
 */
export function isNewAccount(createdAt: Date, joinedAt: Date, maxAgeDays: number): boolean {
  if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) {
    throw new RangeError(`maxAgeDays must be a non-negative finite number, got ${maxAgeDays}`);
  }
  const ageMs = joinedAt.getTime() - createdAt.getTime();
  return ageMs >= 0 && ageMs <= maxAgeDays * MS_PER_DAY;
}

/**
 * 新規アカウント単体ガード(new_account_guard)のヒット判定。レイド(集団)判定とは独立して、
 * 入室したアカウント単体が作成後maxAgeDays日以内ならヒットとする(設計spec「ガード例外」節)。
 */
export function hasNewAccountGuardHit(createdAt: Date, joinedAt: Date, maxAgeDays: number): boolean {
  return isNewAccount(createdAt, joinedAt, maxAgeDays);
}
