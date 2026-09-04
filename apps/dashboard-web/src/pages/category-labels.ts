import { LOG_CATEGORIES, type LogCategory } from "@management-bot/shared";

export const CATEGORY_LABELS: Record<LogCategory, string> = {
  message: "メッセージ",
  member: "メンバー",
  role: "ロール",
  channel: "チャンネル",
  guild: "サーバー",
  thread: "スレッド",
  invite: "招待",
  emoji: "絵文字",
  autoMod: "AutoMod",
  integration: "連携",
  poll: "投票",
  scheduledEvent: "イベント",
  stage: "ステージ",
  auditLogCorrelation: "監査ログ相関",
  moderationCase: "モデレーション",
};

export const CATEGORY_OPTIONS: readonly { value: LogCategory; label: string }[] = LOG_CATEGORIES.map((category) => ({
  value: category,
  label: CATEGORY_LABELS[category],
}));
