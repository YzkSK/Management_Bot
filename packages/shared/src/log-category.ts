export const LOG_CATEGORIES = [
  "message",
  "reaction",
  "member",
  "role",
  "channel",
  "guild",
  "thread",
  "invite",
  "emoji",
  "sticker",
  "autoMod",
  "integration",
  "poll",
  "scheduledEvent",
  "stage",
  "auditLogCorrelation",
  "moderationCase",
  "voice",
] as const;

export type LogCategory = (typeof LOG_CATEGORIES)[number];
