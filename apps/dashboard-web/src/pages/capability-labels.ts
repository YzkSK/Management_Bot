import { CAPABILITIES, type CapabilityName } from "@management-bot/shared";

export const CAPABILITY_LABELS: Record<CapabilityName, string> = {
  VIEW_ACTIVITY: "アクティビティの閲覧",
  MANAGE_ACTIVITY_SETTINGS: "アクティビティ設定の管理",
  VIEW_LOGS: "ログの閲覧",
  VIEW_LOGS_RAW: "ログの生データ閲覧",
  MANAGE_LOGGING_SETTINGS: "ログ設定の管理",
  VIEW_TEMP_VOICE: "一時ボイスチャンネルの閲覧",
  MANAGE_TEMP_VOICE: "一時ボイスチャンネルの管理",
  VIEW_MODERATION: "モデレーションの閲覧",
  MANAGE_MODERATION: "モデレーションの管理",
  MANAGE_ACCESS: "アクセス権限の管理",
  MANAGE_GUILD_SETTINGS: "サーバー設定の管理",
};

export const CAPABILITY_OPTIONS: readonly { value: CapabilityName; label: string; bit: number }[] = (
  Object.keys(CAPABILITIES) as CapabilityName[]
).map((name) => ({ value: name, label: CAPABILITY_LABELS[name], bit: CAPABILITIES[name] }));
