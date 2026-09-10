/** valuesをlimit件ずつ区切り、各バッチ内は並行実行しつつバッチ間は直列に処理する。 */
export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  fn: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < values.length; i += limit) {
    results.push(...(await Promise.all(values.slice(i, i + limit).map(fn))));
  }
  return results;
}
