export {
  MODERATION_PRESETS,
  FLOOD_PRESETS,
  ESCALATION_STEPS,
  type ModerationPreset,
  type FloodPresetConfig,
  type EscalationStep,
} from "./presets.js";
export { hasFloodHit } from "./frequency.js";
export { similarity, isDuplicateContent } from "./duplicate-content.js";
export { decideEscalationAction } from "./escalation.js";
