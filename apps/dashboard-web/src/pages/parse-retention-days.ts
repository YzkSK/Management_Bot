const MAX_RETENTION_DAYS = 36_500;

/** 保持期間入力欄の文字列を検証する。空文字・小数・範囲外・非数値はnull(=サーバー値へ戻す)。 */
export function parseRetentionDaysInput(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_RETENTION_DAYS) {
    return null;
  }
  return parsed;
}

export { MAX_RETENTION_DAYS };
