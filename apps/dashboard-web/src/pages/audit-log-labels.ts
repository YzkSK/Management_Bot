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
  logging: "ログ機能",
  moderation: "スパム対策",
  tempVoice: "一時VC",
  scheduledPost: "予約投稿",
  access: "アクセス権限",
  dashboard: "ダッシュボード",
};

export function auditFeatureLabel(feature: string): string {
  return AUDIT_FEATURE_LABELS[feature] ?? feature;
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
