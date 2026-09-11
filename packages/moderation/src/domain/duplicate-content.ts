import { distance } from "fastest-levenshtein";

function normalize(content: string): string {
  return content.trim().toLowerCase();
}

/** 正規化後のLevenshtein距離ベースの類似度(0〜1)を返す純粋関数。 */
export function similarity(a: string, b: string): number {
  const normA = normalize(a);
  const normB = normalize(b);
  const maxLength = Math.max(normA.length, normB.length);
  if (maxLength === 0) return 1;
  return 1 - distance(normA, normB) / maxLength;
}

/** 2つのメッセージ本文が閾値以上の類似度を持つ(重複投稿とみなせる)かを判定する純粋関数。 */
export function isDuplicateContent(a: string, b: string, similarityThreshold: number): boolean {
  return similarity(a, b) >= similarityThreshold;
}
