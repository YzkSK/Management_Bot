function assertValidFloodConfig(config: { windowSeconds: number; messageThreshold: number }): void {
  if (!Number.isFinite(config.windowSeconds) || config.windowSeconds <= 0) {
    throw new RangeError(`windowSeconds must be a positive finite number, got ${config.windowSeconds}`);
  }
  if (!Number.isInteger(config.messageThreshold) || config.messageThreshold < 1) {
    throw new RangeError(`messageThreshold must be an integer >= 1, got ${config.messageThreshold}`);
  }
}

/**
 * 直近のメッセージタイムスタンプ配列から、固定ウィンドウ方式の連投ヒット判定を行う純粋関数。
 * timestampsは頻度判定・重複判定で共用するRedisバッファの中身を想定し、新規メッセージ自身を含む。
 */
export function hasFloodHit(
  timestamps: readonly Date[],
  now: Date,
  config: { windowSeconds: number; messageThreshold: number },
): boolean {
  assertValidFloodConfig(config);
  const windowStart = now.getTime() - config.windowSeconds * 1000;
  const countInWindow = timestamps.filter((t) => t.getTime() >= windowStart && t.getTime() <= now.getTime()).length;
  return countInWindow >= config.messageThreshold;
}
