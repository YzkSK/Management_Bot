const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Returns whether an account was created within the specified age at the time it joined. */
export function isNewAccount(createdAt: Date, joinedAt: Date, maxAgeDays: number): boolean {
  if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) {
    throw new RangeError(`maxAgeDays must be a non-negative finite number, got ${maxAgeDays}`);
  }
  const ageMs = joinedAt.getTime() - createdAt.getTime();
  return ageMs >= 0 && ageMs <= maxAgeDays * MS_PER_DAY;
}
