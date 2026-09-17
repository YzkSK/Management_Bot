import type { RaidPresetConfig } from "./presets.js";

/** レイド判定用の入室バッファ1件分(Redisバッファの中身を想定)。 */
export interface RaidBufferEntry {
  joinedAt: Date;
  userId: string;
  /** アカウント作成日からRAID_PRESETS.newAccountMaxAgeDaysで判定済みの新規アカウントフラグ。 */
  isNewAccount: boolean;
}

/** ウィンドウ内(joinedAtがnowからwindowSeconds以内)の入室バッファのみを抽出する。 */
export function entriesInWindow(
  buffer: readonly RaidBufferEntry[],
  now: Date,
  windowSeconds: number,
): RaidBufferEntry[] {
  const windowStart = now.getTime() - windowSeconds * 1000;
  return buffer.filter((e) => e.joinedAt.getTime() >= windowStart && e.joinedAt.getTime() <= now.getTime());
}

/** ウィンドウ内入室者数がmemberThreshold以上ならレイドヒットと判定する純粋関数。 */
export function hasRaidHit(entriesInRaidWindow: readonly RaidBufferEntry[], memberThreshold: number): boolean {
  if (!Number.isInteger(memberThreshold) || memberThreshold < 1) {
    throw new RangeError(`memberThreshold must be an integer >= 1, got ${memberThreshold}`);
  }
  return entriesInRaidWindow.length >= memberThreshold;
}

/** ウィンドウ内入室者に占める新規アカウントの比率(0〜1)を算出する。空配列なら0。 */
export function newAccountRatio(entriesInRaidWindow: readonly RaidBufferEntry[]): number {
  if (entriesInRaidWindow.length === 0) return 0;
  const newAccountCount = entriesInRaidWindow.filter((e) => e.isNewAccount).length;
  return newAccountCount / entriesInRaidWindow.length;
}

/**
 * レイドヒット時の危険度。新規アカウント比率がnewAccountRatioThreshold以上なら"high"
 * (エスカレーション段階を通常より重い段階から開始する想定、設計spec「重み付け」節)。
 */
export type RaidSeverity = "normal" | "high";

export function decideRaidSeverity(ratio: number, newAccountRatioThreshold: number): RaidSeverity {
  return ratio >= newAccountRatioThreshold ? "high" : "normal";
}

export interface RaidDetectionResult {
  hit: boolean;
  /** hit=trueの場合のみ意味を持つ。一括アクション対象となる入室者一覧。 */
  targetUserIds: readonly string[];
  severity: RaidSeverity;
}

/** 入室バッファからウィンドウ抽出・人数判定・新規アカウント比率判定までを一括で行う。 */
export function detectRaid(
  buffer: readonly RaidBufferEntry[],
  now: Date,
  config: RaidPresetConfig,
): RaidDetectionResult {
  const windowEntries = entriesInWindow(buffer, now, config.window.windowSeconds);
  const hit = hasRaidHit(windowEntries, config.window.memberThreshold);
  if (!hit) return { hit: false, targetUserIds: [], severity: "normal" };

  const ratio = newAccountRatio(windowEntries);
  const severity = decideRaidSeverity(ratio, config.newAccountRatioThreshold);
  return { hit: true, targetUserIds: windowEntries.map((e) => e.userId), severity };
}
