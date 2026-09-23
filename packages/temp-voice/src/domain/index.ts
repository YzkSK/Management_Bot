export { buildTempVoiceChannelName } from "./channel-name.js";
export { canCreateTempVoiceInCategory, MAX_TEMP_VOICE_PAIRS_PER_CATEGORY } from "./category-limit.js";
export { canRenameWithinRateLimit, RENAME_RATE_LIMIT_WINDOW_MS } from "./rename-rate-limit.js";
export {
  validateChannelName,
  validateUserLimit,
  validateBitrateKbps,
  type ValidationResult,
} from "./validate-input.js";
