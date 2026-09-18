import { buildLeetPattern } from "./leet-pattern.js";
import { toCompact } from "./text-normalization.js";

export type NgwordMatchType = "exact" | "contains" | "regex";

export interface NgwordEntry {
  matchType: NgwordMatchType;
  pattern: string;
}

/**
 * メッセージ本文が1件のNGワードエントリに一致するかを判定する純粋関数。
 * exact/containsはcompact正規化(NFKC+小文字化+ゼロ幅/記号除去)とLEET文字クラス展開により、
 * 全角・ゼロ幅・記号分割・LEETによる回避を検知する(改善案5.4節)。
 * regexはユーザー定義パターンをそのまま使うため正規化を挟まない
 * (自動正規化が意図しない挙動を生むことを避けるため。isSafeRegexPatternで登録時に検証済み)。
 */
export function matchesNgword(content: string, entry: NgwordEntry): boolean {
  if (entry.matchType === "regex") {
    return new RegExp(entry.pattern).test(content.trim());
  }

  const normalizedContent = toCompact(content);
  const normalizedPattern = toCompact(entry.pattern);
  if (normalizedPattern === "") return false;
  const leetPattern = buildLeetPattern(normalizedPattern);
  return entry.matchType === "exact"
    ? new RegExp(`^${leetPattern.source}$`, "u").test(normalizedContent)
    : leetPattern.test(normalizedContent);
}

/** 登録済みNGワードのうち、メッセージ本文に一致する最初の1件を返す(なければnull)。 */
export function findMatchingNgword(content: string, entries: readonly NgwordEntry[]): NgwordEntry | null {
  return entries.find((entry) => matchesNgword(content, entry)) ?? null;
}
