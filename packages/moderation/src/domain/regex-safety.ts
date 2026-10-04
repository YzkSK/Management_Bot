/**
 * NGワード正規表現の安全性を検証するヒューリスティックチェック。
 * ponytail: 完全な最悪計算量解析(数学的検証)ではなく、`(a+)+`のようなネストした量指定子や
 * `(a|a)*`のような曖昧な選択の繰り返しといった、典型的なReDoSパターンを検出する一次防御。
 * 括弧のネスト深さを追跡し、`{n}`(n>=2)のような上限付き反復も反復として扱う。
 * 専用エンジン(re2)は導入せず標準RegExpをこのチェック通過後のpatternにのみ使う。
 * すべてのReDoSパターンを検出できる保証はなく、実運用で問題が出た場合はre2導入や
 * 実行時タイムアウトを検討する。
 */

/** グループ1つ分の走査状態(内部に反復量指定子・選択`|`を含むか)。 */
interface GroupFrame {
  hasRepetition: boolean;
  hasAlternation: boolean;
}

const QUANTIFIER_BRACE = /^\{(\d+)(?:(,)(\d*))?\}/;

/**
 * index位置が量指定子ならその終端(任意の遅延`?`/所有`+`を含む)と、反復(最大回数が2以上
 * または無制限)かどうかを返す。`?`/`{0}`/`{1}`/`{0,1}`等は最大1回なので反復ではない。
 * 量指定子でない(`{`がリテラル等)場合はnull。
 */
function readQuantifier(pattern: string, index: number): { end: number; repetition: boolean } | null {
  const c = pattern[index];
  let end: number;
  let repetition: boolean;
  if (c === "*" || c === "+") {
    end = index + 1;
    repetition = true;
  } else if (c === "?") {
    end = index + 1;
    repetition = false;
  } else if (c === "{") {
    const m = QUANTIFIER_BRACE.exec(pattern.slice(index));
    if (!m) return null;
    end = index + m[0].length;
    const min = Number(m[1]);
    // {n}はn、{n,}は無制限、{n,m}はm が最大回数
    repetition = m[2] === undefined ? min >= 2 : m[3] === "" || Number(m[3]) >= 2;
  } else {
    return null;
  }
  if (pattern[end] === "?" || pattern[end] === "+") end += 1;
  return { end, repetition };
}

/**
 * `[`位置から文字クラスの終端の次のindexを返す(`\]`エスケープを考慮)。
 * JSでは先頭の`]`もクラスを閉じる(`[]`は空クラス、`[^]`は任意文字)。PCRE流に先頭`]`をリテラル扱いすると
 * `[](a+)+`で後続全体を読み飛ばし、危険パターンを見逃すため扱わない。
 */
function skipCharClass(pattern: string, start: number): number {
  let i = start + 1;
  if (pattern[i] === "^") i += 1;
  while (i < pattern.length && pattern[i] !== "]") i += pattern[i] === "\\" ? 2 : 1;
  return i + 1;
}

/** `(`直後の`?:` `?=` `?!` `?<=` `?<!` `?<name>`を読み飛ばし、本体開始indexを返す。 */
function skipGroupModifier(pattern: string, index: number): number {
  if (pattern[index] !== "?") return index;
  const next = pattern[index + 1];
  if (next === "<" && pattern[index + 2] !== "=" && pattern[index + 2] !== "!") {
    const close = pattern.indexOf(">", index);
    return close === -1 ? index + 2 : close + 1;
  }
  return index + (next === "<" ? 3 : 2);
}

/**
 * 反復される(または選択を含み反復される)グループを1パスで検出する。
 * 「内側に反復/選択を含むグループ自体が反復される」ネストを、ネスト深さを追跡して判定する
 * (`((a+))+`や`(.*a){25}`のような二重括弧・{n}形式も対象)。選択肢同士が実際に重複するか
 * (`(a|a)*`は危険、`(foo|bar)*`は安全)は判定せず、選択+反復を一律拒否する保守的な判定とする
 * (ponytail: 重複判定は組合せ爆発を招くため、誤検知を許容してでも簡潔さを優先する)。
 */
function hasNestedRepetition(pattern: string): boolean {
  const root: GroupFrame = { hasRepetition: false, hasAlternation: false };
  const stack: GroupFrame[] = [root];
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    const frame = stack[stack.length - 1] ?? root;
    if (c === "(") {
      stack.push({ hasRepetition: false, hasAlternation: false });
      i = skipGroupModifier(pattern, i + 1);
    } else if (c === ")") {
      const closed = stack.length > 1 ? stack.pop() : undefined;
      const parent = stack[stack.length - 1] ?? root;
      const q = readQuantifier(pattern, i + 1);
      const quantified = q?.repetition === true;
      if (closed) {
        if (quantified && (closed.hasRepetition || closed.hasAlternation)) return true;
        parent.hasRepetition ||= closed.hasRepetition || quantified;
        parent.hasAlternation ||= closed.hasAlternation;
      }
      i = q ? q.end : i + 1;
    } else if (c === "|") {
      frame.hasAlternation = true;
      i += 1;
    } else {
      // エスケープ・文字クラス・通常文字はいずれも1つの原子として扱う
      i = c === "\\" ? i + 2 : c === "[" ? skipCharClass(pattern, i) : i + 1;
      const q = readQuantifier(pattern, i);
      if (q) {
        if (q.repetition) frame.hasRepetition = true;
        i = q.end;
      }
    }
  }
  return false;
}

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

  if (hasNestedRepetition(pattern)) {
    return { safe: false, reason: "potentially catastrophic backtracking pattern (nested/ambiguous repetition)" };
  }

  return { safe: true };
}
