/**
 * NGワード正規表現の安全性を検証するヒューリスティックチェック。
 * ponytail: 完全な最悪計算量解析(数学的検証)ではなく、`(a+)+`のようなネストした量指定子や
 * `(a|a)*`のような曖昧な選択の繰り返しといった、典型的なReDoSパターンを検出する一次防御。
 * 専用エンジン(re2)は導入せず標準RegExpをこのチェック通過後のpatternにのみ使う。
 * すべてのReDoSパターンを検出できる保証はなく、実運用で問題が出た場合はre2導入や
 * 実行時タイムアウトを検討する。
 */

/** グループ内が量指定子(+ * {n,}等)で閉じられ、そのグループ自体にも量指定子が続くネストパターン。 */
const NESTED_QUANTIFIER = /\([^()]*[+*][^()]*\)[+*]|\([^()]*\{\d*,\}[^()]*\)[+*]/;

/** `(a|a)*`のような、選択肢を繰り返す曖昧なパターン(選択肢の重複可能性を厳密には見ないヒューリスティック)。 */
const REPEATED_ALTERNATION = /\([^()]*\|[^()]*\)[+*]/;

const DANGEROUS_PATTERNS: readonly RegExp[] = [NESTED_QUANTIFIER, REPEATED_ALTERNATION];

export interface RegexSafetyResult {
  safe: boolean;
  reason?: string;
}

/** 正規表現パターンの構文妥当性と典型的ReDoS危険パターンを検証する。 */
export function checkRegexSafety(pattern: string): RegexSafetyResult {
  try {
    new RegExp(pattern);
  } catch {
    return { safe: false, reason: "invalid regular expression syntax" };
  }

  if (DANGEROUS_PATTERNS.some((dangerous) => dangerous.test(pattern))) {
    return { safe: false, reason: "potentially catastrophic backtracking pattern (nested/ambiguous repetition)" };
  }

  return { safe: true };
}
