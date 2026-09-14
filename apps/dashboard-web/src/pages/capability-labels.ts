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

interface CapabilityGroup {
  readonly title: string;
  readonly items: readonly CapabilityName[];
}

/** 権限トグルを機能領域ごとにグループ化して表示するための分類。 */
export const CAPABILITY_GROUPS: readonly CapabilityGroup[] = [
  { title: "アクティビティ", items: ["VIEW_ACTIVITY", "MANAGE_ACTIVITY_SETTINGS"] },
  { title: "ログ", items: ["VIEW_LOGS", "VIEW_LOGS_RAW", "MANAGE_LOGGING_SETTINGS"] },
  { title: "一時ボイスチャンネル", items: ["VIEW_TEMP_VOICE", "MANAGE_TEMP_VOICE"] },
  { title: "モデレーション", items: ["VIEW_MODERATION", "MANAGE_MODERATION"] },
  { title: "アクセス権限", items: ["MANAGE_ACCESS"] },
  { title: "サーバー設定", items: ["MANAGE_GUILD_SETTINGS"] },
];

interface CapabilityPreset {
  readonly label: string;
  readonly capabilities: number;
}

/** よく使う権限の組み合わせをワンクリックで選択するためのプリセット。 */
export const CAPABILITY_PRESETS: readonly CapabilityPreset[] = [
  {
    label: "閲覧のみ",
    capabilities: CAPABILITIES.VIEW_ACTIVITY | CAPABILITIES.VIEW_LOGS | CAPABILITIES.VIEW_MODERATION,
  },
  {
    label: "モデレーター",
    capabilities: CAPABILITIES.VIEW_MODERATION | CAPABILITIES.MANAGE_MODERATION | CAPABILITIES.VIEW_LOGS,
  },
  {
    label: "ログ管理者",
    capabilities: CAPABILITIES.VIEW_LOGS | CAPABILITIES.VIEW_LOGS_RAW | CAPABILITIES.MANAGE_LOGGING_SETTINGS,
  },
  {
    label: "フル管理者",
    capabilities: Object.values(CAPABILITIES).reduce((acc, bit) => acc | bit, 0),
  },
];
