/**
 * NGワード正規表現の安全性を検証するヒューリスティックチェック。
 * ponytail: 完全な最悪計算量解析(数学的検証)ではなく、`(a+)+`のようなネストした量指定子や
 * `(a|a)*`のような曖昧な選択の繰り返しといった、典型的なReDoSパターンを検出する一次防御。
 * 専用エンジン(re2)は導入せず標準RegExpをこのチェック通過後のpatternにのみ使う。
 * すべてのReDoSパターンを検出できる保証はなく、実運用で問題が出た場合はre2導入や
 * 実行時タイムアウトを検討する。
 */

/** `+`, `*`, `{n,}`, `{n,m}`のいずれか(上限なし反復を含む量指定子)。 */
const QUANTIFIER_SUFFIX = "(?:[+*]|\\{\\d+,\\d*\\})";
const INNER_QUANTIFIER = `[+*]|\\{\\d*,\\}`;

/**
 * グループ内が量指定子(+ * {n,}等)で閉じられ、そのグループ自体にも量指定子(+ * {n,} {n,m})が
 * 続くネストパターン。外側の量指定子を`)+`/`)*`だけに限定すると`(a+){1,}`のような`{n,}`形式の
 * 外側反復を見逃すため(Codexレビュー指摘)、内外どちらも同じQUANTIFIER_SUFFIXで判定する。
 */
const NESTED_QUANTIFIER = new RegExp(`\\([^()]*(?:${INNER_QUANTIFIER})[^()]*\\)${QUANTIFIER_SUFFIX}`);

/**
 * `(a|a)*`のような、選択肢を繰り返す曖昧なパターン。選択肢同士が実際に重複しているか
 * (`(a|a)*`は危険、`(foo|bar)*`は安全)は判定せず、選択肢+繰り返し自体を一律拒否する
 * 保守的なヒューリスティックとする(ponytail: 選択肢の重複判定は組合せ爆発を招くため、
 * 誤検知(安全なパターンの拒否)を許容してでも簡潔さを優先する)。
 */
const REPEATED_ALTERNATION = new RegExp(`\\([^()]*\\|[^()]*\\)${QUANTIFIER_SUFFIX}`);

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
