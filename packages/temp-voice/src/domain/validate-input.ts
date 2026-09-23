export type ValidationResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** チャンネル名: 空文字禁止・100文字以内(Discordのチャンネル名上限)。 */
export function validateChannelName(input: string): ValidationResult<string> {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, message: "チャンネル名を入力してください。" };
  if (trimmed.length > 100) return { ok: false, message: "チャンネル名は100文字以内で入力してください。" };
  return { ok: true, value: trimmed };
}

/** 人数制限: 0〜99の整数(0=無制限)。 */
export function validateUserLimit(input: string): ValidationResult<number> {
  const value = Number(input.trim());
  if (!Number.isInteger(value)) return { ok: false, message: "人数は整数で入力してください。" };
  if (value < 0 || value > 99) return { ok: false, message: "人数は0〜99の範囲で入力してください(0=無制限)。" };
  return { ok: true, value };
}

/**
 * 音質(kbps単位の入力)をbps単位のビットレートに変換して検証する。
 * 上限はギルドのブーストレベルに依存するため呼び出し元(maximumBitrateBps)から渡す。
 */
export function validateBitrateKbps(input: string, maximumBitrateBps: number): ValidationResult<number> {
  const kbps = Number(input.trim());
  if (!Number.isInteger(kbps) || kbps <= 0) return { ok: false, message: "音質は正の整数(kbps)で入力してください。" };
  const bps = kbps * 1000;
  if (bps > maximumBitrateBps) {
    return { ok: false, message: `このサーバーの音質上限は${Math.floor(maximumBitrateBps / 1000)}kbpsです。` };
  }
  return { ok: true, value: bps };
}
