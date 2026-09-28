/** Discord APIのチャンネルrenameレート制限(2回/10分/チャンネル)。 */
const MAX_RENAMES_PER_WINDOW = 2;
const WINDOW_MS = 10 * 60 * 1000;

/**
 * 直近のrename実行時刻(ms epoch、windowMs以内のもののみ)を渡して、
 * 新たに1回renameしてよいか判定する。純粋関数(呼び出し元が状態の保持・更新を担当する)。
 */
export function canRenameWithinRateLimit(recentRenameTimestamps: readonly number[], now: number): boolean {
  const withinWindow = recentRenameTimestamps.filter((ts) => now - ts < WINDOW_MS);
  return withinWindow.length < MAX_RENAMES_PER_WINDOW;
}

export { WINDOW_MS as RENAME_RATE_LIMIT_WINDOW_MS };
