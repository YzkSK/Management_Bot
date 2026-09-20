import { distance } from "fastest-levenshtein";

function normalize(content: string): string {
  return content.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

const CHARACTER_COSINE_SIMILARITY_THRESHOLD = 0.95;
const COMMON_SUBSTRING_COVERAGE_THRESHOLD = 0.75;

function characterFrequencies(content: string): ReadonlyMap<string, number> {
  const frequencies = new Map<string, number>();
  for (const character of Array.from(content)) {
    frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
  }
  return frequencies;
}

function characterCosineSimilarity(normA: string, normB: string): number {
  const frequenciesA = characterFrequencies(normA);
  const frequenciesB = characterFrequencies(normB);
  if (frequenciesA.size === 0 || frequenciesB.size === 0) return 0;

  let dotProduct = 0;
  let magnitudeASquared = 0;
  let magnitudeBSquared = 0;
  for (const count of frequenciesA.values()) magnitudeASquared += count * count;
  for (const count of frequenciesB.values()) magnitudeBSquared += count * count;
  for (const [character, countA] of frequenciesA) {
    dotProduct += countA * (frequenciesB.get(character) ?? 0);
  }
  return dotProduct / Math.sqrt(magnitudeASquared * magnitudeBSquared);
}

function hasCommonSubstringCoverage(normA: string, normB: string): boolean {
  const charactersA = Array.from(normA);
  const charactersB = Array.from(normB);
  const shorterLength = Math.min(charactersA.length, charactersB.length);
  if (shorterLength < 2) return false;

  let previousRow = Array<number>(charactersB.length + 1).fill(0);
  let longestLength = 0;
  for (let aIndex = 1; aIndex <= charactersA.length; aIndex++) {
    const currentRow = Array<number>(charactersB.length + 1).fill(0);
    for (let bIndex = 1; bIndex <= charactersB.length; bIndex++) {
      if (charactersA[aIndex - 1] !== charactersB[bIndex - 1]) continue;
      currentRow[bIndex] = (previousRow[bIndex - 1] ?? 0) + 1;
      longestLength = Math.max(longestLength, currentRow[bIndex] ?? 0);
    }
    previousRow = currentRow;
  }
  return longestLength / shorterLength >= COMMON_SUBSTRING_COVERAGE_THRESHOLD;
}

function similarityOfNormalized(normA: string, normB: string): number {
  const maxLength = Math.max(normA.length, normB.length);
  if (maxLength === 0) return 1;
  return 1 - distance(normA, normB) / maxLength;
}

/**
 * 正規化後のLevenshtein距離ベースの類似度(0〜1)を返す純粋関数。
 * ponytail: 文字数はUTF-16コードユニット単位(string.length)で計算するため、
 * 絵文字・結合文字を多く含む投稿では類似度が実際の見た目とずれ得る。
 * 書記素単位での比較が必要になったらIntl.Segmenterへの置き換えを検討する。
 */
export function similarity(a: string, b: string): number {
  return similarityOfNormalized(normalize(a), normalize(b));
}

/**
 * 2つのメッセージ本文が閾値以上の類似度を持つ(重複投稿とみなせる)かを判定する純粋関数。
 * 正規化後に両方とも空文字列になる場合は重複とみなさない(画像・スタンプのみの投稿等、
 * 本文が空の投稿同士が無条件で類似度1になり誤検知することを防ぐため)。
 */
export function isDuplicateContent(a: string, b: string, similarityThreshold: number): boolean {
  if (!Number.isFinite(similarityThreshold) || similarityThreshold < 0 || similarityThreshold > 1) {
    throw new RangeError(`similarityThreshold must be between 0 and 1, got ${similarityThreshold}`);
  }
  const normA = normalize(a);
  const normB = normalize(b);
  if (normA === "" && normB === "") return false;
  return (
    similarityOfNormalized(normA, normB) >= similarityThreshold ||
    characterCosineSimilarity(normA, normB) >= CHARACTER_COSINE_SIMILARITY_THRESHOLD ||
    hasCommonSubstringCoverage(normA, normB)
  );
}
