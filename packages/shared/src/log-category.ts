export const LOG_CATEGORIES = [
  "message",
  "member",
  "role",
  "channel",
  "guild",
  "thread",
  "invite",
  "emoji",
  "autoMod",
  "integration",
  "poll",
  "scheduledEvent",
  "stage",
  "auditLogCorrelation",
  "moderationCase",
] as const;

export type LogCategory = (typeof LOG_CATEGORIES)[number];
