/** 配列内の値が全て同じならその値を、1つでも異なれば(=個別に上書きされている)undefinedを返す。 */
export function uniformValue<T>(values: readonly T[]): T | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const [first, ...rest] = values;
  return rest.every((value) => value === first) ? first : undefined;
}
