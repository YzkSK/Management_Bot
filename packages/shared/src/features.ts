export interface FeatureMetadata {
  key: string;
  name: string;
  description: string;
}

// TODO: 暫定の機能一覧。実装が進んだら実際の機能に合わせて更新する。
export const FEATURE_METADATA: readonly FeatureMetadata[] = [
  {
    key: "voice-channel-management",
    name: "ボイスチャンネル管理",
    description: "ボイスチャンネルの自動作成・削除を管理する",
  },
];
