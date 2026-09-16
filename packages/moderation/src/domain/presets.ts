import { MODERATION_PRESETS, type ModerationActionType, type ModerationPreset } from "@management-bot/shared";

export { MODERATION_PRESETS, type ModerationPreset };

export interface FloodPresetConfig {
  /** 直近windowSeconds秒間にmessageThreshold件以上でヒット。 */
  frequency: { windowSeconds: number; messageThreshold: number };
  /** Levenshtein類似度(0〜1)がこの値以上で重複投稿としてヒット。 */
  duplicateSimilarityThreshold: number;
}

export const FLOOD_PRESETS: Readonly<Record<ModerationPreset, FloodPresetConfig>> = {
  weak: {
    frequency: { windowSeconds: 10, messageThreshold: 8 },
    duplicateSimilarityThreshold: 0.95,
  },
  medium: {
    frequency: { windowSeconds: 10, messageThreshold: 5 },
    duplicateSimilarityThreshold: 0.9,
  },
  strong: {
    frequency: { windowSeconds: 8, messageThreshold: 3 },
    duplicateSimilarityThreshold: 0.85,
  },
};

/**
 * エスカレーション段階1件分。actionType="timeout"の場合のみtimeoutMinutesを持つ
 * (#322、タイムアウトの多段階化)。それ以外のactionTypeではtimeoutMinutesを持たない。
 */
export type EscalationStep =
  | { actionType: Exclude<ModerationActionType, "timeout">; timeoutMinutes?: never }
  | { actionType: "timeout"; timeoutMinutes: number };

/**
 * guild単位のエスカレーション強度プリセット。strikeCount(違反種別を跨いだ合計)ごとの
 * エスカレーション段階を定義する。strikeCount以下で最大のキーの段階を採用する
 * (decideEscalationActionの仕様)。
 * メッセージ削除は独立したアクション種別ではなく、warn以降の全アクションに付随する
 * 処理として実行される(executeEscalationAction参照、#321)。旧messageDelete段階は
 * 隣接するwarn段階に統合した。
 * timeoutは5分→10分→30分の3段階でエスカレーションする(#322)。
 */
export const ESCALATION_STEPS: Readonly<Record<ModerationPreset, Readonly<Record<number, EscalationStep>>>> = {
  weak: {
    1: { actionType: "warn" },
    5: { actionType: "timeout", timeoutMinutes: 5 },
    6: { actionType: "timeout", timeoutMinutes: 10 },
    7: { actionType: "timeout", timeoutMinutes: 30 },
    8: { actionType: "kick" },
  },
  medium: {
    1: { actionType: "warn" },
    3: { actionType: "timeout", timeoutMinutes: 5 },
    4: { actionType: "timeout", timeoutMinutes: 10 },
    5: { actionType: "timeout", timeoutMinutes: 30 },
    6: { actionType: "kick" },
  },
  strong: {
    1: { actionType: "warn" },
    2: { actionType: "timeout", timeoutMinutes: 5 },
    3: { actionType: "timeout", timeoutMinutes: 10 },
    4: { actionType: "timeout", timeoutMinutes: 30 },
    5: { actionType: "kick" },
    6: { actionType: "ban" },
  },
};
