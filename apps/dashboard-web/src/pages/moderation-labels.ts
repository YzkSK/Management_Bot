import type { ModerationPreset, ModerationViolationType } from "@management-bot/shared";

export const VIOLATION_TYPE_LABELS: Record<ModerationViolationType, string> = {
  flood: "連投",
  duplicate_content: "内容重複",
};

export const PRESET_LABELS: Record<ModerationPreset, string> = {
  weak: "弱",
  medium: "中",
  strong: "強",
};

/**
 * packages/moderation/src/domain/presets.ts のFLOOD_PRESETSをUI表示用に説明文化したもの。
 * dashboard-webはdiscord.js等を含む@management-bot/moderationパッケージ全体には依存しないため
 * (ブラウザバンドルにサーバー専用コードを混入させないため)、表示用の値をここに複製する。
 * presets.tsの値を変更した場合はこちらも合わせて更新すること。
 * flood(連投)は件数条件、duplicate_content(内容重複)は類似度条件のみで判定される
 * (frequencyとduplicateSimilarityThresholdは独立した別々の検知ロジック)。
 *
 * 統一ストライクカウンター(#311)以降、何回目の違反でwarn/messageDelete/timeout等に
 * なるか(エスカレーション段階)は違反種別のプリセットではなくguild単位の
 * escalationPreset(EscalationPresetSelector)で決まるため、ここでは検知条件のみを説明する。
 */
const CONDITION_DESCRIPTIONS: Record<ModerationViolationType, Record<ModerationPreset, string>> = {
  flood: {
    weak: "10秒間に8件以上の投稿で検知",
    medium: "10秒間に5件以上の投稿で検知",
    strong: "8秒間に3件以上の投稿で検知",
  },
  duplicate_content: {
    weak: "投稿内容の類似度が95%以上で検知",
    medium: "投稿内容の類似度が90%以上で検知",
    strong: "投稿内容の類似度が85%以上で検知",
  },
};

/**
 * packages/moderation/src/domain/presets.ts のESCALATION_STEPSをUI表示用に説明文化したもの。
 * guild単位のエスカレーション強度セレクター(EscalationPresetSelector)の説明表示に使う。
 * ESCALATION_STEPSの値を変更した場合はこちらも合わせて更新すること。
 */
export const ESCALATION_DESCRIPTIONS: Record<ModerationPreset, string> = {
  weak: "1回目:警告 → 3回目:メッセージ削除 → 5回目:タイムアウト → 7回目:キック",
  medium: "1回目:警告 → 2回目:メッセージ削除 → 3回目:タイムアウト → 4回目:キック",
  strong: "1回目:メッセージ削除 → 2回目:タイムアウト → 3回目:キック → 4回目:BAN",
};

export function describePreset(violationType: ModerationViolationType, preset: ModerationPreset): string {
  return CONDITION_DESCRIPTIONS[violationType][preset];
}
