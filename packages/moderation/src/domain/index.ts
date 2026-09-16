export {
  MODERATION_PRESETS,
  FLOOD_PRESETS,
  MENTION_SPAM_PRESETS,
  ESCALATION_STEPS,
  type ModerationPreset,
  type FloodPresetConfig,
  type MentionSpamPresetConfig,
  type EscalationStep,
} from "./presets.js";
export { hasFloodHit } from "./frequency.js";
export { similarity, isDuplicateContent } from "./duplicate-content.js";
export { decideEscalationAction } from "./escalation.js";
export { matchesNgword, findMatchingNgword, type NgwordMatchType, type NgwordEntry } from "./ngword.js";
export { checkRegexSafety, type RegexSafetyResult } from "./regex-safety.js";
export { countMentions, hasSingleMessageMentionSpam, hasCumulativeMentionSpam } from "./mention-spam.js";
