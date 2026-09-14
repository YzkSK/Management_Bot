/** role/channel/guild updateのchangesキーを表示用の日本語ラベルに変換する。未知キーはそのまま表示する。 */
export const CHANGE_FIELD_LABELS: Record<string, string> = {
  nickname: "ニックネーム",
  name: "名前",
  color: "色",
  hoist: "表示を分離",
  mentionable: "メンション許可",
  permissions: "権限",
  topic: "トピック",
  nsfw: "年齢制限",
  rateLimitPerUser: "スロー モード",
  bitrate: "ビットレート",
  userLimit: "ユーザー上限",
  icon: "アイコン",
  banner: "バナー",
  description: "説明",
  verificationLevel: "認証レベル",
  explicitContentFilter: "不適切なコンテンツフィルター",
  defaultMessageNotifications: "デフォルトの通知設定",
  afkChannelId: "AFKチャンネル",
  afkTimeout: "AFKタイムアウト",
  systemChannelId: "システムチャンネル",
  rulesChannelId: "ルールチャンネル",
  publicUpdatesChannelId: "公開アップデートチャンネル",
  preferredLocale: "優先言語",
  widgetEnabled: "ウィジェット有効",
  widgetChannelId: "ウィジェットチャンネル",
};

/** guild updateのchangesのうち、値がチャンネルIDであるフィールド。表示名解決の対象にする。 */
export const CHANNEL_REFERENCE_CHANGE_FIELDS = new Set([
  "afkChannelId",
  "systemChannelId",
  "rulesChannelId",
  "publicUpdatesChannelId",
  "widgetChannelId",
]);

/** changesのbefore/after値を表示用文字列に変換する。nullはtopic未設定等を表すため「未設定」と表示する。チャンネルIDフィールドは解決済み名称があれば使う。 */
export function formatChangeValue(
  field: string,
  value: string | number | boolean | null,
  channelNames: Record<string, string>,
): string {
  if (value === null) return "未設定";
  if (CHANNEL_REFERENCE_CHANGE_FIELDS.has(field) && typeof value === "string") return channelNames[value] ?? value;
  return String(value);
}
