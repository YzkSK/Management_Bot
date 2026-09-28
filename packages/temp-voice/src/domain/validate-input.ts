import { buildTempVoiceChannelName } from "./channel-name.js";

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** 空白のみ・空文字はNaN扱いにする(Number("")===0による誤入力の受理を防ぐ、codexレビュー指摘)。 */
function parseStrictInteger(input: string): number {
  const trimmed = input.trim();
  if (trimmed.length === 0) return NaN;
  return Number(trimmed);
}

/** チャンネル名: 空文字禁止・100文字以内(Discordのチャンネル名上限)。 */
export function validateChannelName(input: string): ValidationResult<string> {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, message: "チャンネル名を入力してください。" };
  if (trimmed.length > 100) return { ok: false, message: "チャンネル名は100文字以内で入力してください。" };
  return { ok: true, value: trimmed };
}

/** 人数制限: 0〜99の整数(0=無制限)。 */
export function validateUserLimit(input: string): ValidationResult<number> {
  const value = parseStrictInteger(input);
  if (!Number.isInteger(value)) return { ok: false, message: "人数は整数で入力してください。" };
  if (value < 0 || value > 99) return { ok: false, message: "人数は0〜99の範囲で入力してください(0=無制限)。" };
  return { ok: true, value };
}

/** Discordのボイスチャンネルのビットレート下限(8kbps)。 */
const MIN_BITRATE_KBPS = 8;

/**
 * 音質(kbps単位の入力)をbps単位のビットレートに変換して検証する。
 * 上限はギルドのブーストレベルに依存するため呼び出し元(maximumBitrateBps)から渡す。
 * 下限8kbpsはDiscord API側の制約(codexレビュー指摘: 1〜7kbpsはsetBitrateが失敗する)。
 */
export function validateBitrateKbps(input: string, maximumBitrateBps: number): ValidationResult<number> {
  const kbps = parseStrictInteger(input);
  if (!Number.isInteger(kbps) || kbps < MIN_BITRATE_KBPS) {
    return { ok: false, message: `音質は${MIN_BITRATE_KBPS}kbps以上の整数で入力してください。` };
  }
  const bps = kbps * 1000;
  if (bps > maximumBitrateBps) {
    return { ok: false, message: `このサーバーの音質上限は${Math.floor(maximumBitrateBps / 1000)}kbpsです。` };
  }
  return { ok: true, value: bps };
}

/**
 * nameTemplate: 空文字禁止。{username}展開後の長さで100文字判定するため、
 * 展開結果を仮のユーザー名("username")で試算する(実際の入室者名は可変長のため、
 * ここでは固定文字列部分が長すぎないかの目安チェックに留める、#415)。
 */
export function validateNameTemplate(input: string): ValidationResult<string> {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, message: "名前テンプレートを入力してください。" };
  const expanded = buildTempVoiceChannelName(trimmed, "username");
  if (expanded.length >= 100) {
    return { ok: false, message: "名前テンプレートが長すぎます。展開後100文字以内になるようにしてください。" };
  }
  return { ok: true, value: trimmed };
}
