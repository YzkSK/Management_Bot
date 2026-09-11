import { distance } from "fastest-levenshtein";

function normalize(content: string): string {
  return content.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * 正規化後のLevenshtein距離ベースの類似度(0〜1)を返す純粋関数。
 * ponytail: 文字数はUTF-16コードユニット単位(string.length)で計算するため、
 * 絵文字・結合文字を多く含む投稿では類似度が実際の見た目とずれ得る。
 * 書記素単位での比較が必要になったらIntl.Segmenterへの置き換えを検討する。
 */
export function similarity(a: string, b: string): number {
  const normA = normalize(a);
  const normB = normalize(b);
  const maxLength = Math.max(normA.length, normB.length);
  if (maxLength === 0) return 1;
  return 1 - distance(normA, normB) / maxLength;
}

/** 2つのメッセージ本文が閾値以上の類似度を持つ(重複投稿とみなせる)かを判定する純粋関数。 */
export function isDuplicateContent(a: string, b: string, similarityThreshold: number): boolean {
  if (!Number.isFinite(similarityThreshold) || similarityThreshold < 0 || similarityThreshold > 1) {
    throw new RangeError(`similarityThreshold must be between 0 and 1, got ${similarityThreshold}`);
  }
  return similarity(a, b) >= similarityThreshold;
}
