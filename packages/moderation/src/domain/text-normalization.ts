/** LEET対応表(leet-pattern.ts)が使う記号。区切り文字除去では保持し、文字クラス展開に委ねる。 */
const LEET_RESERVED_CHARS = new Set(["@", "$", "!", "+", "|"]);

/**
 * 空白・句読点・記号・制御文字・書式文字(Unicodeカテゴリ Z/P/S/Cc/Cf)。
 * `b.a.d.w.o.r.d`のような記号分割や、タブ・改行、ゼロ幅文字(U+200B等)・bidi制御文字(U+202E等)
 * といった不可視文字の挿入による回避を無効化するため除去する。
 */
const SEPARATOR_CHARS = /[\p{Z}\p{P}\p{S}\p{Cc}\p{Cf}]/gu;

/**
 * NGワード照合用の正規化ビュー(compact)を生成する純粋関数。
 * NFKC正規化(全角→半角等)→小文字化→空白/記号/制御文字除去の順に適用する。
 * duplicate-content.tsのnormalize()と同じNFKC+小文字化のアプローチを踏襲し、
 * NGワード回避で使われやすい不可視文字挿入・記号分割にも対応する。
 * LEET対応表が使う記号(@ $ ! + |)は除去せず残し、leet-pattern.tsでの文字クラス展開に委ねる。
 */
export function toCompact(content: string): string {
  return content
    .normalize("NFKC")
    .toLowerCase()
    .replace(SEPARATOR_CHARS, (char) => (LEET_RESERVED_CHARS.has(char) ? char : ""));
}
