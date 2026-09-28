import { ACTION_SEVERITY, type ModerationActionType } from "@management-bot/shared";

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

/**
 * 同一メッセージで複数の違反が同時にヒットした場合に、Discord側で実行する1件
 * (actionTypeが最も重いもの)を選ぶ。同じ重さの場合は先に出てきたものを採用する。
 */
export function mostSevere<T extends { actionType: ModerationActionType }>(outcomes: readonly T[]): T {
  return outcomes.reduce((most, outcome) =>
    ACTION_SEVERITY[outcome.actionType] > ACTION_SEVERITY[most.actionType] ? outcome : most,
  );
}
