import { LOG_CATEGORIES, type LogCategory } from "@management-bot/shared";

export const CATEGORY_LABELS: Record<LogCategory, string> = {
  message: "メッセージ",
  reaction: "リアクション",
  member: "メンバー",
  role: "ロール",
  channel: "チャンネル",
  guild: "サーバー",
  thread: "スレッド",
  invite: "招待",
  emoji: "絵文字",
  sticker: "スタンプ",
  autoMod: "AutoMod",
  integration: "連携",
  poll: "投票",
  scheduledEvent: "イベント",
  stage: "ステージ",
  auditLogCorrelation: "監査ログ相関",
  moderationCase: "モデレーション",
  voice: "ボイスチャンネル",
};

export const CATEGORY_OPTIONS: readonly { value: LogCategory; label: string }[] = LOG_CATEGORIES.map((category) => ({
  value: category,
  label: CATEGORY_LABELS[category],
}));

export const CATEGORY_ACCENT: Record<LogCategory, string> = {
  message: "oklch(0.55 0.14 250)",
  reaction: "oklch(0.55 0.14 250)",
  member: "oklch(0.6 0.14 150)",
  role: "oklch(0.65 0.15 90)",
  channel: "oklch(0.6 0.12 200)",
  guild: "oklch(0.556 0 0)",
  thread: "oklch(0.6 0.12 200)",
  invite: "oklch(0.6 0.12 200)",
  emoji: "oklch(0.556 0 0)",
  sticker: "oklch(0.556 0 0)",
  autoMod: "oklch(0.577 0.19 27)",
  integration: "oklch(0.556 0 0)",
  poll: "oklch(0.556 0 0)",
  scheduledEvent: "oklch(0.556 0 0)",
  stage: "oklch(0.556 0 0)",
  auditLogCorrelation: "oklch(0.556 0 0)",
  moderationCase: "oklch(0.577 0.19 27)",
  voice: "oklch(0.55 0.16 305)",
};
