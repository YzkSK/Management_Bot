export const MODERATION_PRESETS = ["weak", "medium", "strong"] as const;

export type ModerationPreset = (typeof MODERATION_PRESETS)[number];
