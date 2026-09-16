/**
 * strikeCountに対して適用すべき段階を、プリセットのescalationSteps定義から決定する純粋関数。
 * strikeCount以下で最大のキーの段階を採用する(未定義の間は直前のステップを維持)。
 * escalationStepsに1件も定義がない、もしくはstrikeCountが最小キーを下回る場合はnullを返す。
 */
export function decideEscalationAction<Step>(
  strikeCount: number,
  escalationSteps: Readonly<Record<number, Step>>,
): Step | null {
  if (!Number.isInteger(strikeCount) || strikeCount < 0) {
    throw new RangeError(`strikeCount must be a non-negative integer, got ${strikeCount}`);
  }
  const applicableKeys = Object.keys(escalationSteps)
    .map(Number)
    .filter((key) => key <= strikeCount)
    .sort((a, b) => b - a);
  const key = applicableKeys[0];
  return key === undefined ? null : (escalationSteps[key] ?? null);
}
