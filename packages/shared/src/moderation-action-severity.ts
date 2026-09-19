import type { ModerationActionType } from "./moderation-action-type.js";

/**
 * actionTypeの重さ。複数のactionTypeが同一対象に競合した場合、より重い方を優先する基準として使う
 * (例: 同一メッセージで複数violationTypeが同時ヒットした場合の実行対象選定、
 * raid一括timeoutとnew_account_guard処罰が同一入室者に同時ヒットした場合の優先度判定)。
 */
export const ACTION_SEVERITY: Record<ModerationActionType, number> = {
  warn: 0,
  timeout: 1,
  kick: 2,
  ban: 3,
  unban: -1,
};
