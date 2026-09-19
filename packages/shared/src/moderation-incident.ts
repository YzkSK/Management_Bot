import { z } from "zod";
import { MODERATION_ESCALATION_VIOLATION_TYPES } from "./moderation-violation-type.js";

const messageModerationIncidentSchema = z.object({
  violationType: z.enum(MODERATION_ESCALATION_VIOLATION_TYPES),
  score: z.number().int().nonnegative().nullable(),
  matchedMessageCount: z.number().int().positive(),
  deletedMessageCount: z.number().int().nonnegative(),
  strikeCount: z.number().int().positive(),
});

const raidModerationIncidentSchema = z.object({
  violationType: z.literal("raid"),
  score: z.null(),
  matchedMessageCount: z.number().int().positive(),
  deletedMessageCount: z.number().int().nonnegative(),
  strikeCount: z.null(),
  raidSeverity: z.enum(["normal", "high"]),
  raidTargetCount: z.number().int().positive(),
});

export const moderationIncidentSchema = z.discriminatedUnion("violationType", [
  messageModerationIncidentSchema,
  raidModerationIncidentSchema,
]);

export type ModerationIncident = z.infer<typeof moderationIncidentSchema>;
