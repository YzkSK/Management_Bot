export {
  MODERATION_PRESETS,
  FLOOD_PRESETS,
  MENTION_SPAM_PRESETS,
  RAID_PRESETS,
  NEW_ACCOUNT_GUARD_PRESETS,
  ESCALATION_STEPS,
  type ModerationPreset,
  type FloodPresetConfig,
  type MentionSpamPresetConfig,
  type RaidPresetConfig,
  type NewAccountGuardPresetConfig,
  type EscalationStep,
} from "./presets.js";
export { hasFloodHit } from "./frequency.js";
export { similarity, isDuplicateContent } from "./duplicate-content.js";
export { decideEscalationAction } from "./escalation.js";
export { matchesNgword, findMatchingNgword, type NgwordMatchType, type NgwordEntry } from "./ngword.js";
export { checkRegexSafety, type RegexSafetyResult } from "./regex-safety.js";
export { countMentions, hasSingleMessageMentionSpam, hasCumulativeMentionSpam } from "./mention-spam.js";
export { extractInviteCodes, hasInviteLinkHit } from "./invite-link.js";
export {
  entriesInWindow,
  hasRaidHit,
  newAccountRatio,
  decideRaidSeverity,
  detectRaid,
  escalateSeverityByIncidentCount,
  REPEAT_INCIDENT_SEVERITY_THRESHOLD,
  type RaidBufferEntry,
  type RaidSeverity,
  type RaidDetectionResult,
} from "./raid.js";
export { isNewAccount, hasNewAccountGuardHit } from "./new-account-guard.js";
export { isWhitelistMatch, type WhitelistMatchEntry } from "./whitelist-match.js";
