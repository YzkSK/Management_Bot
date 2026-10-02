/**
 * ビットフラグRBAC。ビット位置は以後「末尾への追記のみ」とし、並べ替え・欠番の詰め直しは禁止。
 * (実効capabilitiesがDBやセッションに永続化されるため、位置がずれると過去に付与した権限の意味が変わってしまう)
 * 削除したcapabilityのビットは欠番として残し、再利用しない。
 */
export const CAPABILITIES = {
  VIEW_ACTIVITY: 1 << 0,
  // 1 << 1: 旧MANAGE_ACTIVITY_SETTINGS(未使用のため削除。issue #527)
  VIEW_LOGS: 1 << 2,
  VIEW_LOGS_RAW: 1 << 3,
  MANAGE_LOGGING_SETTINGS: 1 << 4,
  VIEW_TEMP_VOICE: 1 << 5,
  MANAGE_TEMP_VOICE: 1 << 6,
  // 1 << 7: 旧VIEW_MODERATION(スパム対策は設定画面のみでMANAGE_MODERATIONに統合。issue #527)
  MANAGE_MODERATION: 1 << 8,
  MANAGE_ACCESS: 1 << 9,
  // 1 << 10: 旧MANAGE_GUILD_SETTINGS(サーバー単位の設定項目が無いため削除。issue #527)
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

/**
 * 未定義ビットや負数・非整数を含まない、既知のcapability集合のみを表すかを判定する。
 * ビット演算(&)は32bit符号付き整数に丸められるため、value自体の範囲チェック
 * (value <= ALL_CAPABILITIES)を先に行う。これが無いと`2**32 + n`のような安全整数が
 * 32bit演算で下位ビットに切り詰められ、範囲外の値を誤って既知マスクと判定してしまう。
 */
export function isKnownCapabilityMask(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= ALL_CAPABILITIES &&
    (value & ~ALL_CAPABILITIES) === 0
  );
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

/**
 * [依存するcapability, その前提となるcapability]の組(issue #527)。管理・生データ閲覧は対応する閲覧権限を前提とし、
 * 「管理できるがページを閲覧できない」組み合わせを付与できないようにする。
 */
const CAPABILITY_PREREQUISITES: readonly (readonly [number, number])[] = [
  [CAPABILITIES.VIEW_LOGS_RAW, CAPABILITIES.VIEW_LOGS],
  [CAPABILITIES.MANAGE_LOGGING_SETTINGS, CAPABILITIES.VIEW_LOGS],
  [CAPABILITIES.MANAGE_TEMP_VOICE, CAPABILITIES.VIEW_TEMP_VOICE],
];

/** 含まれるすべてのcapabilityについて、その前提capabilityも含まれているか。 */
export function hasCapabilityPrerequisites(caps: number): boolean {
  return CAPABILITY_PREREQUISITES.every(
    ([dependent, prerequisite]) => !hasCapability(caps, dependent) || hasCapability(caps, prerequisite),
  );
}

/** 含まれるcapabilityの前提capabilityを追加する(付与画面でONにしたとき用)。 */
export function addCapabilityPrerequisites(caps: number): number {
  return CAPABILITY_PREREQUISITES.reduce(
    (acc, [dependent, prerequisite]) => (hasCapability(acc, dependent) ? acc | prerequisite : acc),
    caps,
  );
}

/** 前提capabilityが欠けたcapabilityを取り除く(付与画面でOFFにしたとき用)。 */
export function removeUnmetDependents(caps: number): number {
  return CAPABILITY_PREREQUISITES.reduce(
    (acc, [dependent, prerequisite]) => (hasCapability(acc, prerequisite) ? acc : acc & ~dependent),
    caps,
  );
}
