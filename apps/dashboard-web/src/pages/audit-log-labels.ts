export type AuditLogOutcome = "pending" | "success" | "failure" | "denied";

export const AUDIT_OUTCOME_LABELS: Record<AuditLogOutcome, string> = {
  success: "成功",
  failure: "失敗",
  denied: "権限不足",
  // 実行前に記録した後、結果の確定に失敗した(または実行中の)操作。
  pending: "結果不明",
};

/** tRPCのルーター名(audit_logs.feature)→表示名。未知のキーはそのまま表示する。 */
const AUDIT_FEATURE_LABELS: Record<string, string> = {
  logging: "ログ",
  moderation: "スパム対策",
  tempVoice: "一時VC",
  scheduledPost: "予約投稿",
  access: "アクセス権限",
  dashboard: "ダッシュボード",
};

/**
 * 機能ごとの色。`--c`をセットするTailwindクラス(ライト/ダーク)。タイムラインの点と機能名タグが`var(--c)`で参照する。
 * 未知の機能はグレー。
 */
const AUDIT_FEATURE_COLORS: Record<string, string> = {
  logging: "[--c:oklch(0.55_0.15_150)] dark:[--c:oklch(0.78_0.15_150)]",
  moderation: "[--c:oklch(0.58_0.17_30)] dark:[--c:oklch(0.78_0.14_30)]",
  tempVoice: "[--c:oklch(0.55_0.15_250)] dark:[--c:oklch(0.78_0.12_250)]",
  scheduledPost: "[--c:oklch(0.56_0.14_200)] dark:[--c:oklch(0.8_0.12_200)]",
  access: "[--c:oklch(0.55_0.17_300)] dark:[--c:oklch(0.78_0.14_300)]",
  dashboard: "[--c:oklch(0.55_0.02_260)] dark:[--c:oklch(0.75_0.02_260)]",
};
const AUDIT_FEATURE_COLOR_FALLBACK = "[--c:oklch(0.55_0_0)] dark:[--c:oklch(0.75_0_0)]";

export function auditFeatureColorClass(feature: string): string {
  return AUDIT_FEATURE_COLORS[feature] ?? AUDIT_FEATURE_COLOR_FALLBACK;
}

export function auditFeatureLabel(feature: string): string {
  return AUDIT_FEATURE_LABELS[feature] ?? feature;
}

/**
 * `feature.action`(tRPCのmutationのパス)→「{操作者} が ○○」に続く操作の文。
 * mutationを追加したらここにも追加する(audit-log-labels.test.tsが全mutationの網羅を検証する)。
 */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "logging.setRetentionSetting": "ログの保存期間を変更",
  "logging.setChannelSetting": "ログの出力先チャンネルを変更",
  "logging.setRetentionSettingForAllCategories": "全カテゴリのログ保存期間を変更",
  "logging.setChannelSettingForAllCategories": "全カテゴリのログ出力先チャンネルを変更",
  "logging.setDisplaySetting": "ログ一覧の表示設定を変更",
  "moderation.setThreshold": "検知の基準を変更",
  "moderation.addToWhitelist": "ホワイトリストに追加",
  "moderation.removeFromWhitelist": "ホワイトリストから削除",
  "moderation.resetStrike": "ストライクをリセット",
  "moderation.setEscalationPreset": "エスカレーションの強度を変更",
  "moderation.setAutoLockdownOnRaid": "レイド検知時の自動ロックダウン設定を変更",
  "moderation.setLockdownRequested": "サーバーのロックダウンを切り替え",
  "moderation.resetAllStrikes": "ユーザーのストライクをすべてリセット",
  "moderation.addNgword": "NGワードを追加",
  "moderation.removeNgword": "NGワードを削除",
  "scheduledPost.cancel": "予約投稿を取り消し",
  "scheduledPost.updateSettings": "予約投稿の設定を変更",
  "tempVoice.setConfig": "一時VCの設定を変更",
  "tempVoice.autoSetupConfig": "一時VCを自動セットアップ",
  "tempVoice.clearConfig": "一時VCの設定を解除",
  "tempVoice.setDenyProtectedRoles": "一時VCの拒否禁止ロールを変更",
  "tempVoice.forceDelete": "一時VCを強制削除",
  "access.grantCapabilities": "アクセス権限を付与・変更",
  "access.revokeCapabilityGrant": "アクセス権限を削除",
};

/** 未知の操作はaction名をそのまま表示する。 */
export function auditActionLabel(feature: string, action: string): string {
  return AUDIT_ACTION_LABELS[`${feature}.${action}`] ?? action;
}

export function auditOutcomeLabel(outcome: string): string {
  const labels: Record<string, string> = AUDIT_OUTCOME_LABELS;
  return labels[outcome] ?? outcome;
}

/** `<input type="date">`の値(YYYY-MM-DD、ローカル日付)を期間の境界(ISO日時)に変換する。空ならundefined。 */
export function dateInputToIso(value: string, endOfDay: boolean): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y ?? 0, (m ?? 1) - 1, (d ?? 1) + (endOfDay ? 1 : 0));
  return date.toISOString();
}

export type AuditPeriod = "all" | "today" | "7d" | "30d" | "custom";

export const AUDIT_PERIODS: readonly AuditPeriod[] = ["all", "today", "7d", "30d", "custom"];

export const AUDIT_PERIOD_LABELS: Record<AuditPeriod, string> = {
  all: "すべて",
  today: "今日",
  "7d": "過去7日間",
  "30d": "過去30日間",
  custom: "期間を指定",
};

const PERIOD_DAYS: Record<"today" | "7d" | "30d", number> = { today: 1, "7d": 7, "30d": 30 };

/**
 * 期間の選択をAPIの境界(ISO日時)に変換する。「過去N日間」は今日を含むN日分(当日0時起点)。
 * 日単位で丸めるのは、秒単位の現在時刻をクエリキーに含めて再取得が走り続けるのを避けるため。
 */
export function periodToRange(
  period: AuditPeriod,
  fromDate: string,
  toDate: string,
  now: Date = new Date(),
): { from: string | undefined; to: string | undefined } {
  if (period === "custom") return { from: dateInputToIso(fromDate, false), to: dateInputToIso(toDate, true) };
  if (period === "all") return { from: undefined, to: undefined };
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (PERIOD_DAYS[period] - 1));
  return { from: start.toISOString(), to: undefined };
}
