import { buildLeetPattern } from "./leet-pattern.js";
import { toCompact } from "./text-normalization.js";

export type NgwordMatchType = "exact" | "contains" | "regex";

export interface NgwordEntry {
  matchType: NgwordMatchType;
  pattern: string;
}

function matchesNormalizedNgword(normalizedContent: string, rawContent: string, entry: NgwordEntry): boolean {
  if (entry.matchType === "regex") {
    return new RegExp(entry.pattern).test(rawContent.trim());
  }

  const normalizedPattern = toCompact(entry.pattern);
  if (normalizedPattern === "") return false;
  const leetPattern = buildLeetPattern(normalizedPattern);
  return entry.matchType === "exact"
    ? new RegExp(`^${leetPattern.source}$`, "u").test(normalizedContent)
    : leetPattern.test(normalizedContent);
}

/**
 * メッセージ本文が1件のNGワードエントリに一致するかを判定する純粋関数。
 * exact/containsはcompact正規化(NFKC+小文字化+ゼロ幅/記号除去)とLEET文字クラス展開により、
 * 全角・ゼロ幅・記号分割・LEETによる回避を検知する(改善案5.4節)。LEET文字クラス展開の性質上、
 * `go`が`60`にもマッチするなど短い単語ほど誤検知率が上がる既知の限界がある。
 * regexはユーザー定義パターンをそのまま使うため正規化を挟まない
 * (自動正規化が意図しない挙動を生むことを避けるため。isSafeRegexPatternで登録時に検証済み)。
 */
export function matchesNgword(content: string, entry: NgwordEntry): boolean {
  return matchesNormalizedNgword(toCompact(content), content, entry);
}

/**
 * 登録済みNGワードのうち、メッセージ本文に一致する最初の1件を返す(なければnull)。
 * 本文のcompact正規化(NFKC等)はエントリ数に関わらず1回だけ行う。
 */
export function findMatchingNgword(content: string, entries: readonly NgwordEntry[]): NgwordEntry | null {
  const normalizedContent = toCompact(content);
  return entries.find((entry) => matchesNormalizedNgword(normalizedContent, content, entry)) ?? null;
}
