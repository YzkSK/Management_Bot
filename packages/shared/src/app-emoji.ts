/** Botに登録済みのアプリケーション絵文字(assets/emojis/から起動時に自動登録される)。 */
export interface AppEmoji {
  id: string;
  name: string;
  animated: boolean;
}

/**
 * 絵文字名 → 登録済みアプリ絵文字。Bot起動時に呼び出し側(apps/bot)から注入する。
 * 機能パッケージ(logging/temp-voice等)はBotに依存せずここから引く。未注入なら常に空。
 */
const registered = new Map<string, AppEmoji>();

export function setAppEmojis(emojis: readonly AppEmoji[]): void {
  registered.clear();
  for (const emoji of emojis) registered.set(emoji.name, emoji);
}

/** ボタン等のコンポーネントの`setEmoji`向け。未登録ならundefined。 */
export function findAppEmoji(name: string): AppEmoji | undefined {
  return registered.get(name);
}

/** メッセージ本文向けの`<:name:id>`記法。未登録・取得失敗時はfallback(Unicode絵文字等)を返す。 */
export function appEmojiText(name: string, fallback: string): string {
  const emoji = registered.get(name);
  if (!emoji) return fallback;
  return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
}
