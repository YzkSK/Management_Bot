/** ゼロ幅文字(U+200B, U+200C, U+200D, U+FEFF)。NGワード回避目的での挿入を無効化するため除去する。 */
const ZERO_WIDTH_CHARS = /[​‌‍﻿]/g;

/** LEET対応表(leet-pattern.ts)が使う記号。区切り文字除去では保持し、文字クラス展開に委ねる。 */
const LEET_RESERVED_CHARS = new Set(["@", "$", "!", "+", "|"]);

/** 空白・句読点・記号(Unicodeカテゴリ Z/P/S)。`b.a.d.w.o.r.d`のような記号分割による回避を無効化するため除去する。 */
const SEPARATOR_CHARS = /[\p{Z}\p{P}\p{S}]/gu;

/**
 * NGワード照合用の正規化ビュー(compact)を生成する純粋関数。
 * NFKC正規化(全角→半角等)→小文字化→ゼロ幅文字除去→空白/記号除去の順に適用する。
 * duplicate-content.tsのnormalize()と同じNFKC+小文字化のアプローチを踏襲し、
 * NGワード回避で使われやすいゼロ幅文字・記号分割にも対応する。
 * LEET対応表が使う記号(@ $ ! + |)は除去せず残し、leet-pattern.tsでの文字クラス展開に委ねる。
 */
export function toCompact(content: string): string {
  return content
    .normalize("NFKC")
    .toLowerCase()
    .replace(ZERO_WIDTH_CHARS, "")
    .replace(SEPARATOR_CHARS, (char) => (LEET_RESERVED_CHARS.has(char) ? char : ""));
}
