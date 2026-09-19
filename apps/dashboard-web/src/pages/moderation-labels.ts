import type { ModerationPreset, ModerationViolationType } from "@management-bot/shared";

export const VIOLATION_TYPE_LABELS: Record<ModerationViolationType, string> = {
  flood: "連投",
  duplicate_content: "内容重複",
  ngword: "NGワード",
  mention_spam: "メンションスパム",
  invite_link: "招待リンク",
  link_spam: "外部リンク・宣伝",
  raid: "レイド(大量入室)",
  new_account_guard: "新規アカウントガード",
};

export const PRESET_LABELS: Record<ModerationPreset, string> = {
  weak: "弱",
  medium: "中",
  strong: "強",
};

/** NGワード・招待リンクは種別固有の検知条件が強度で変わらない。 */
export function isPresetIndependentViolationType(violationType: ModerationViolationType): boolean {
  return violationType === "ngword" || violationType === "invite_link";
}

export type NgwordMatchType = "exact" | "contains" | "regex";

export const NGWORD_MATCH_TYPE_LABELS: Record<NgwordMatchType, string> = {
  exact: "完全一致",
  contains: "部分一致",
  regex: "正規表現",
};

/**
 * packages/moderation/src/domain/presets.ts のFLOOD_PRESETSをUI表示用に説明文化したもの。
 * dashboard-webはdiscord.js等を含む@management-bot/moderationパッケージ全体には依存しないため
 * (ブラウザバンドルにサーバー専用コードを混入させないため)、表示用の値をここに複製する。
 * presets.tsの値を変更した場合はこちらも合わせて更新すること。
 * flood(連投)は件数条件、duplicate_content(内容重複)は類似度条件のみで判定される
 * (frequencyとduplicateSimilarityThresholdは独立した別々の検知ロジック)。
 *
 * 統一ストライクカウンター(#311)以降、何回目の違反でwarn/timeout等になるか
 * (エスカレーション段階)は違反種別のプリセットではなくguild単位の
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
  ngword: {
    weak: "登録済みNGワードに一致した投稿を検知(強度に関わらず共通)",
    medium: "登録済みNGワードに一致した投稿を検知(強度に関わらず共通)",
    strong: "登録済みNGワードに一致した投稿を検知(強度に関わらず共通)",
  },
  // packages/moderation/src/domain/presets.ts のMENTION_SPAM_PRESETSをUI表示用に説明文化したもの。
  mention_spam: {
    weak: "1メッセージ10件以上、または10秒間の合計15件以上のメンションで検知",
    medium: "1メッセージ6件以上、または10秒間の合計10件以上のメンションで検知",
    strong: "1メッセージ4件以上、または8秒間の合計6件以上のメンションで検知",
  },
  // packages/moderation/src/domain/presets.ts のINVITE_LINK_PRESETSをUI表示用に説明文化したもの(#186実装後に確定)。
  invite_link: {
    weak: "他ギルドへの招待リンクを含む投稿を検知(強度に関わらず共通)",
    medium: "他ギルドへの招待リンクを含む投稿を検知(強度に関わらず共通)",
    strong: "他ギルドへの招待リンクを含む投稿を検知(強度に関わらず共通)",
  },
  // packages/moderation/src/domain/presets.ts のLINK_SPAM_PRESETSをUI表示用に説明文化したもの。
  link_spam: {
    weak: "参加24時間以内・宣伝語句・メンション併用・短縮URL等のスコア合計が55点以上で検知",
    medium: "参加24時間以内・宣伝語句・メンション併用・短縮URL等のスコア合計が45点以上で検知",
    strong: "参加24時間以内・宣伝語句・メンション併用・短縮URL等のスコア合計が35点以上で検知",
  },
  // packages/moderation/src/domain/presets.ts のRAID_PRESETSをUI表示用に説明文化したもの。
  // 新規アカウント比率が閾値以上、または同一ギルドでの検知が2回目以降の場合は
  // より長いtimeout(危険度highのtimeoutMinutes)が適用される(設計spec「重み付け」節)。
  raid: {
    weak: "30秒間に15人以上の入室で検知(作成3日以内の比率80%以上でより長いタイムアウト)",
    medium: "30秒間に10人以上の入室で検知(作成7日以内の比率60%以上でより長いタイムアウト)",
    strong: "30秒間に6人以上の入室で検知(作成14日以内の比率40%以上でより長いタイムアウト)",
  },
  // packages/moderation/src/domain/presets.ts のNEW_ACCOUNT_GUARD_PRESETSをUI表示用に説明文化したもの。
  new_account_guard: {
    weak: "作成から1日以内のアカウントの入室を検知",
    medium: "作成から3日以内のアカウントの入室を検知",
    strong: "作成から7日以内のアカウントの入室を検知",
  },
};

/**
 * packages/moderation/src/domain/presets.ts のESCALATION_STEPSをUI表示用に説明文化したもの。
 * guild単位のエスカレーション強度セレクター(EscalationPresetSelector)の説明表示に使う。
 * ESCALATION_STEPSの値を変更した場合はこちらも合わせて更新すること。
 * メッセージ削除は独立したアクション種別ではなく警告以降の全対応に付随して実行されるため、
 * ここでは表示しない(#321)。タイムアウトは5分→10分→30分と多段階化する(#322)。
 */
export const ESCALATION_DESCRIPTIONS: Record<ModerationPreset, string> = {
  weak: "1回目:警告 → 5回目:5分タイムアウト → 6回目:10分タイムアウト → 7回目:30分タイムアウト → 8回目:キック",
  medium: "1回目:警告 → 3回目:5分タイムアウト → 4回目:10分タイムアウト → 5回目:30分タイムアウト → 6回目:キック",
  strong: "1回目:警告 → 2回目:5分タイムアウト → 3回目:10分タイムアウト → 4回目:30分タイムアウト → 5回目:キック → 6回目:BAN",
};

export function describePreset(violationType: ModerationViolationType, preset: ModerationPreset): string {
  return CONDITION_DESCRIPTIONS[violationType][preset];
}
