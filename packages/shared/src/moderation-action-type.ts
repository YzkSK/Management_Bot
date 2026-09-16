/**
 * メッセージ削除はwarn以降の全アクションに付随する処理として実行されるため、
 * 独立したアクション種別としては存在しない(executeEscalationAction参照、#321)。
 */
export const MODERATION_ACTION_TYPES = ["warn", "timeout", "kick", "ban", "unban"] as const;

export type ModerationActionType = (typeof MODERATION_ACTION_TYPES)[number];
