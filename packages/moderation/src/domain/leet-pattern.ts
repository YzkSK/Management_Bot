/**
 * LEET文字対応表。`1`は`i`にも`l`にも見えるため両方に含めるなど、投稿側を一律変換するのではなく
 * NGワード側の各文字を安全な文字クラスへ展開する方式を取る(改善案5.4節参照)。
 */
const LEET_ALIASES: Readonly<Record<string, string>> = {
  a: "a4@",
  b: "b8",
  e: "e3",
  g: "g69",
  i: "i1!|",
  l: "l1!|",
  o: "o0",
  s: "s5$",
  t: "t7+",
};

/** 正規表現の特殊文字をエスケープする。 */
function escapeRegExpChar(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * compact正規化済みのNGワードパターン文字列から、LEET文字クラスを使った動的正規表現を生成する。
 * 1文字ずつLEET_ALIASESの文字クラス(またはエスケープした単一文字)へ置換して連結するだけで、
 * ネストした量指定子や選択の繰り返しを含まない構造上安全なパターンになる
 * (regex-safety.tsのReDoSチェックは対象外でよい)。
 */
export function buildLeetPattern(compactPattern: string): RegExp {
  const parts = Array.from(compactPattern).map((char) => {
    const aliases = LEET_ALIASES[char];
    return aliases ? `[${aliases}]` : escapeRegExpChar(char);
  });
  return new RegExp(parts.join(""), "u");
}
