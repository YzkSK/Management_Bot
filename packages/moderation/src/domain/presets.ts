import type { ModerationActionType } from "@management-bot/shared";

export const MODERATION_PRESETS = ["weak", "medium", "strong"] as const;
export type ModerationPreset = (typeof MODERATION_PRESETS)[number];

export interface FloodPresetConfig {
  /** 直近windowSeconds秒間にmessageThreshold件以上でヒット。 */
  frequency: { windowSeconds: number; messageThreshold: number };
  /** Levenshtein類似度(0〜1)がこの値以上で重複投稿としてヒット。 */
  duplicateSimilarityThreshold: number;
  /**
   * strikeCountごとのアクション。キーに満たない小さいstrikeCountは
   * 定義済みキーのうち最大のもの以下で直近のステップを適用し、
   * 最大キーを超えるstrikeCountは最大キーのアクションを維持する。
   */
  escalationSteps: Readonly<Record<number, ModerationActionType>>;
}

export const FLOOD_PRESETS: Readonly<Record<ModerationPreset, FloodPresetConfig>> = {
  weak: {
    frequency: { windowSeconds: 10, messageThreshold: 8 },
    duplicateSimilarityThreshold: 0.95,
    escalationSteps: { 1: "warn", 3: "messageDelete", 5: "timeout", 7: "kick" },
  },
  medium: {
    frequency: { windowSeconds: 10, messageThreshold: 5 },
    duplicateSimilarityThreshold: 0.9,
    escalationSteps: { 1: "warn", 2: "messageDelete", 3: "timeout", 4: "kick" },
  },
  strong: {
    frequency: { windowSeconds: 8, messageThreshold: 3 },
    duplicateSimilarityThreshold: 0.85,
    escalationSteps: { 1: "messageDelete", 2: "timeout", 3: "kick", 4: "ban" },
  },
};
