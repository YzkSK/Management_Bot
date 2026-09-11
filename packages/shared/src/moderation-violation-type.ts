export const MODERATION_VIOLATION_TYPES = ["flood", "duplicate_content"] as const;

export type ModerationViolationType = (typeof MODERATION_VIOLATION_TYPES)[number];
