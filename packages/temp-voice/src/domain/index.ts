export { buildTempVoiceChannelName } from "./channel-name.js";
export { canCreateTempVoiceInCategory, MAX_TEMP_VOICE_PAIRS_PER_CATEGORY } from "./category-limit.js";
export { canRenameWithinRateLimit, RENAME_RATE_LIMIT_WINDOW_MS } from "./rename-rate-limit.js";
export {
  validateChannelName,
  validateUserLimit,
  validateBitrateKbps,
  validateNameTemplate,
  type ValidationResult,
} from "./validate-input.js";
export {
  tempVoiceStateKey,
  serializeTempVoiceChannelState,
  parseTempVoiceChannelState,
  parseTempVoiceStateHash,
  type TempVoiceChannelState,
  type TempVoiceMemberState,
} from "./channel-state.js";
export {
  tempVoiceActionResultKey,
  TEMP_VOICE_ACTION_RESULT_FIELD,
  serializeTempVoiceActionResult,
  parseTempVoiceActionResult,
  TEMP_VOICE_ACTION_FAILURE_REASONS,
  type TempVoiceActionFailureReason,
  type TempVoiceActionResult,
} from "./action-result.js";
export {
  buildVoiceSessionEndedEvent,
  type VoiceSessionEndedInput,
  type VoiceSessionEndedEventPayload,
} from "./voice-session.js";
