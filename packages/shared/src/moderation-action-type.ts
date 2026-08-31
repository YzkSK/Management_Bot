export const MODERATION_ACTION_TYPES = [
  "warn",
  "messageDelete",
  "timeout",
  "kick",
  "ban",
  "unban",
] as const;

export type ModerationActionType = (typeof MODERATION_ACTION_TYPES)[number];
