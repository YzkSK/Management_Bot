import { CAPABILITIES } from "./capabilities.js";

export interface FeatureMetadata {
  key: string;
  name: string;
  description: string;
  icon: string;
  viewCapability: number;
  defaultEnabled: boolean;
}

const FEATURE_METADATA_LIST = [
  {
    key: "activity",
    name: "アクティビティモニター",
    description: "VC滞在時間・メッセージ数・リアクション数・活動スコアを計測する",
    icon: "activity",
    viewCapability: CAPABILITIES.VIEW_ACTIVITY,
    defaultEnabled: true,
  },
  {
    key: "logging",
    name: "ログ機能",
    description: "メッセージ・メンバー・ロール等のサーバーイベントを記録する",
    icon: "scroll-text",
    viewCapability: CAPABILITIES.VIEW_LOGS,
    defaultEnabled: true,
  },
  {
    key: "temp-voice",
    name: "一時VC",
    description: "Join to Create方式で一時的なボイスチャンネルを作成・管理する",
    icon: "mic",
    viewCapability: CAPABILITIES.VIEW_TEMP_VOICE,
    defaultEnabled: true,
  },
  {
    key: "moderation",
    name: "スパム対策",
    description: "連投・招待リンク・レイド・NGワード等を検知し段階的に対応する",
    icon: "shield-alert",
    viewCapability: CAPABILITIES.MANAGE_MODERATION,
    defaultEnabled: false,
  },
] as const satisfies readonly FeatureMetadata[];

export const FEATURE_METADATA: readonly FeatureMetadata[] = FEATURE_METADATA_LIST;

export const FEATURE_KEYS: readonly string[] = FEATURE_METADATA_LIST.map((f) => f.key);

export type FeatureKey = (typeof FEATURE_METADATA_LIST)[number]["key"];
