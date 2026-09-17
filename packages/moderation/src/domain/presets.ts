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

export interface MentionSpamPresetConfig {
  /** 1メッセージ内のメンション数がこの値以上で単発ヒット。 */
  singleMessageThreshold: number;
  /** 直近windowSeconds秒間の合計メンション数がこの値以上で累積ヒット。 */
  cumulative: { windowSeconds: number; mentionThreshold: number };
}

export const MENTION_SPAM_PRESETS: Readonly<Record<ModerationPreset, MentionSpamPresetConfig>> = {
  weak: {
    singleMessageThreshold: 10,
    cumulative: { windowSeconds: 10, mentionThreshold: 15 },
  },
  medium: {
    singleMessageThreshold: 6,
    cumulative: { windowSeconds: 10, mentionThreshold: 10 },
  },
  strong: {
    singleMessageThreshold: 4,
    cumulative: { windowSeconds: 8, mentionThreshold: 6 },
  },
};

export interface RaidPresetConfig {
  /** 直近windowSeconds秒間にmemberThreshold人以上入室でヒット。 */
  window: { windowSeconds: number; memberThreshold: number };
  /** 入室から起算してこの日数以内のアカウントを「新規アカウント」とみなす。 */
  newAccountMaxAgeDays: number;
  /** ウィンドウ内入室者に占める新規アカウント比率(0〜1)がこの値以上なら重い危険度とする。 */
  newAccountRatioThreshold: number;
  /**
   * レイドヒット時、対象ユーザー全員へ一括実行するtimeoutの時間(分)。
   * 危険度(RaidSeverity)がhighならnewAccountRatioThreshold以上の比率が新規アカウントで
   * 占められている=より悪質とみなし、normalより長いtimeoutを適用する(設計spec「重み付け」節)。
   */
  timeoutMinutes: { normal: number; high: number };
}

/**
 * レイド(大量入室)検知のプリセット。weak/medium/strongの強度ごとに
 * ウィンドウ・人数閾値・新規アカウント判定日数・比率閾値を定義する(設計spec「重み付け」節)。
 */
export const RAID_PRESETS: Readonly<Record<ModerationPreset, RaidPresetConfig>> = {
  weak: {
    window: { windowSeconds: 30, memberThreshold: 15 },
    newAccountMaxAgeDays: 3,
    newAccountRatioThreshold: 0.8,
    timeoutMinutes: { normal: 10, high: 30 },
  },
  medium: {
    window: { windowSeconds: 30, memberThreshold: 10 },
    newAccountMaxAgeDays: 7,
    newAccountRatioThreshold: 0.6,
    timeoutMinutes: { normal: 30, high: 60 },
  },
  strong: {
    window: { windowSeconds: 30, memberThreshold: 6 },
    newAccountMaxAgeDays: 14,
    newAccountRatioThreshold: 0.4,
    timeoutMinutes: { normal: 60, high: 1440 },
  },
};

export interface NewAccountGuardPresetConfig {
  /** 入室から起算してこの日数以内のアカウントをガード対象とみなす。 */
  maxAgeDays: number;
}

/** 新規アカウント単体ガード(new_account_guard)のプリセット。レイド判定とは独立した閾値。 */
export const NEW_ACCOUNT_GUARD_PRESETS: Readonly<Record<ModerationPreset, NewAccountGuardPresetConfig>> = {
  weak: { maxAgeDays: 1 },
  medium: { maxAgeDays: 3 },
  strong: { maxAgeDays: 7 },
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
