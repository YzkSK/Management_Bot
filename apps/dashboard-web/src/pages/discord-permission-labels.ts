import { DISCORD_PERMISSION_LABELS } from "@management-bot/shared";

const KNOWN_BITS_MASK = DISCORD_PERMISSION_LABELS.reduce((mask, { bit }) => mask | bit, 0n);

function permissionNamesForBits(value: bigint): string[] {
  const names = DISCORD_PERMISSION_LABELS.filter(({ bit }) => (value & bit) === bit).map(({ label }) => label);
  const unknownBits = value & ~KNOWN_BITS_MASK;
  if (unknownBits !== 0n) names.push(`不明な権限(0b${unknownBits.toString(2)})`);
  return names;
}

/**
 * 権限ビットフィールドのbefore/afterを比較し、追加された権限名・削除された権限名を返す。
 * 数値として解釈できない値(不正データ)が渡された場合はnullを返し、呼び出し側で従来のbefore/after文字列表示にフォールバックさせる。
 */
export function diffPermissions(before: string, after: string): { added: string[]; removed: string[] } | null {
  if (!/^\d+$/.test(before) || !/^\d+$/.test(after)) return null;
  const beforeValue = BigInt(before);
  const afterValue = BigInt(after);
  const beforeNames = new Set(permissionNamesForBits(beforeValue));
  const afterNames = new Set(permissionNamesForBits(afterValue));
  return {
    added: [...afterNames].filter((name) => !beforeNames.has(name)),
    removed: [...beforeNames].filter((name) => !afterNames.has(name)),
  };
}
