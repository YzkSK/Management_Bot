import { appEmojiText } from "@management-bot/shared";

/**
 * 一時VCの操作への返信で使う状態アイコン(assets/emojis/)と、未登録・取得失敗時のフォールバック。
 * 画像が存在することはテストで検証する。
 */
export const STATUS_APP_EMOJIS = {
  success: { name: "status_success", fallback: "✅" },
  warning: { name: "status_warning", fallback: "⚠️" },
  failed: { name: "status_failed", fallback: "❌" },
} as const satisfies Record<string, { name: string; fallback: string }>;

export type StatusKind = keyof typeof STATUS_APP_EMOJIS;

/** 返信文の先頭に状態アイコンを付ける。success=操作完了、warning=操作できない・入力不備、failed=Discord API等の失敗。 */
export function statusText(kind: StatusKind, message: string): string {
  const { name, fallback } = STATUS_APP_EMOJIS[kind];
  return `${appEmojiText(name, fallback)} ${message}`;
}
