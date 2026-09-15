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
 * guild単位のエスカレーション強度プリセット。strikeCount(違反種別を跨いだ合計)ごとの
 * アクション種別を定義する。strikeCount以下で最大のキーのアクションを採用する
 * (decideEscalationActionの仕様、値はFLOOD_PRESETSと分離する前の各プリセットの
 * escalationStepsをそのまま移植したもの)。
 */
export const ESCALATION_STEPS: Readonly<Record<ModerationPreset, Readonly<Record<number, ModerationActionType>>>> = {
  weak: { 1: "warn", 3: "messageDelete", 5: "timeout", 7: "kick" },
  medium: { 1: "warn", 2: "messageDelete", 3: "timeout", 4: "kick" },
  strong: { 1: "messageDelete", 2: "timeout", 3: "kick", 4: "ban" },
};
