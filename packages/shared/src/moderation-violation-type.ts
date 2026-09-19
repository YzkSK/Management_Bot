/**
 * moderation_escalation_stateはユーザー単位状態のため、ギルド単位の集団現象であるraidは含まない
 * (raidはmoderation_raid_stateで別管理する)。
 */
export const MODERATION_ESCALATION_VIOLATION_TYPES = [
  "flood",
  "duplicate_content",
  "ngword",
  "mention_spam",
  "invite_link",
  "link_spam",
  "new_account_guard",
] as const;

export const MODERATION_VIOLATION_TYPES = [...MODERATION_ESCALATION_VIOLATION_TYPES, "raid"] as const;

export type ModerationViolationType = (typeof MODERATION_VIOLATION_TYPES)[number];

/** moderation_escalation_state/ストライクAPIが扱うviolationType(raidを除く)。 */
export type ModerationEscalationViolationType = (typeof MODERATION_ESCALATION_VIOLATION_TYPES)[number];
