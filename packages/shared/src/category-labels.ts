import type { LogCategory } from "./log-category.js";

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
  tempVoice: "一時VC",
};
