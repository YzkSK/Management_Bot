export type NgwordMatchType = "exact" | "contains" | "regex";

export interface NgwordEntry {
  matchType: NgwordMatchType;
  pattern: string;
}

function normalize(content: string): string {
  return content.trim();
}

/**
 * メッセージ本文が1件のNGワードエントリに一致するかを判定する純粋関数。
 * regexは登録時にisSafeRegexPatternで検証済みのpatternのみを渡す前提とする
 * (未検証パターンをここで実行しない)。
 */
export function matchesNgword(content: string, entry: NgwordEntry): boolean {
  const normalized = normalize(content);
  switch (entry.matchType) {
    case "exact":
      return normalized === entry.pattern;
    case "contains":
      return normalized.includes(entry.pattern);
    case "regex":
      return new RegExp(entry.pattern).test(normalized);
  }
}

/** 登録済みNGワードのうち、メッセージ本文に一致する最初の1件を返す(なければnull)。 */
export function findMatchingNgword(content: string, entries: readonly NgwordEntry[]): NgwordEntry | null {
  return entries.find((entry) => matchesNgword(content, entry)) ?? null;
}
