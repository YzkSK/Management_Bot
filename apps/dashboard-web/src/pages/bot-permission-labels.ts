/** 機能ごとにBotへ必要なDiscord権限の表示名(BotPermissionStateに渡す)。bot側のREQUIRED_PERMISSIONSと対応する。 */
export const BOT_PERMISSION_LABELS = {
  moderation: ["メッセージの管理", "チャンネルの管理", "メンバーをタイムアウト", "メンバーをキック", "メンバーをBAN"],
  scheduledPost: ["チャンネルを見る", "メッセージを送信", "スレッドでメッセージを送信"],
} as const satisfies Record<string, readonly string[]>;
