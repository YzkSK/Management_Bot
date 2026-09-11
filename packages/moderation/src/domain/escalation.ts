import type { ModerationActionType } from "@management-bot/shared";

/**
 * strikeCountに対して適用すべきアクションを、プリセットのescalationSteps定義から決定する純粋関数。
 * strikeCount以下で最大のキーのアクションを採用する(未定義の間は直前のステップを維持)。
 * escalationStepsに1件も定義がない、もしくはstrikeCountが最小キーを下回る場合はnullを返す。
 */
export function decideEscalationAction(
  strikeCount: number,
  escalationSteps: Readonly<Record<number, ModerationActionType>>,
): ModerationActionType | null {
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
