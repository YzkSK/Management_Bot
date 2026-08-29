/**
 * ビットフラグRBAC。ビット位置は以後「末尾への追記のみ」とし、並べ替え・欠番の詰め直しは禁止。
 * (実効capabilitiesがDBやセッションに永続化されるため、位置がずれると過去に付与した権限の意味が変わってしまう)
 */
export const CAPABILITIES = {
  VIEW_ACTIVITY: 1 << 0,
  MANAGE_ACTIVITY_SETTINGS: 1 << 1,
  VIEW_LOGS: 1 << 2,
  VIEW_LOGS_RAW: 1 << 3,
  MANAGE_LOGGING_SETTINGS: 1 << 4,
  VIEW_TEMP_VOICE: 1 << 5,
  MANAGE_TEMP_VOICE: 1 << 6,
  VIEW_MODERATION: 1 << 7,
  MANAGE_MODERATION: 1 << 8,
  MANAGE_ACCESS: 1 << 9,
  MANAGE_GUILD_SETTINGS: 1 << 10,
} as const;

export type CapabilityName = keyof typeof CAPABILITIES;

export const ALL_CAPABILITIES: number = Object.values(CAPABILITIES).reduce(
  (acc, bit) => acc | bit,
  0,
);

/** @everyone に付与するデフォルトcapabilities。閲覧系の基本機能のみ。 */
export const BASELINE_EVERYONE_CAPABILITIES: number =
  CAPABILITIES.VIEW_ACTIVITY | CAPABILITIES.VIEW_LOGS | CAPABILITIES.VIEW_TEMP_VOICE;

export function hasCapability(granted: number, required: number): boolean {
  return (granted & required) === required;
}

/** 未定義ビットや負数・非整数を含まない、既知のcapability集合のみを表すかを判定する。 */
export function isKnownCapabilityMask(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && (value & ~ALL_CAPABILITIES) === 0;
}

/**
 * 付与者(granterCaps)が自分の持たないcapabilityを他者に付与する昇格を防止する。
 * targetCapsがgranterCapsの部分集合である場合のみtrueを返す。
 * 未定義ビット・負数を含む値はDB/API境界からの汚染とみなし拒否する。
 */
export function canGrantCapabilities(granterCaps: number, targetCaps: number): boolean {
  return (
    isKnownCapabilityMask(granterCaps) &&
    isKnownCapabilityMask(targetCaps) &&
    (targetCaps & ~granterCaps) === 0
  );
}
