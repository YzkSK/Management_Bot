export const MODERATION_VIOLATION_TYPES = ["flood", "duplicate_content", "ngword", "mention_spam"] as const;

export type ModerationViolationType = (typeof MODERATION_VIOLATION_TYPES)[number];
