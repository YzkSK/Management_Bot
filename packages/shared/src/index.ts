export {
  CAPABILITIES,
  ALL_CAPABILITIES,
  BASELINE_EVERYONE_CAPABILITIES,
  hasCapability,
  canGrantCapabilities,
  isKnownCapabilityMask,
  hasCapabilityPrerequisites,
  addCapabilityPrerequisites,
  removeUnmetDependents,
  type CapabilityName,
} from "./capabilities.js";
export {
  FEATURE_KEYS,
  FEATURE_METADATA,
  type FeatureKey,
  type FeatureMetadata,
} from "./feature-registry.js";
export {
  DOMAIN_EVENT_SCHEMAS,
  voiceSessionEndedSchema,
  moderationActionRecordedSchema,
  tempVoiceEventRecordedSchema,
  type DomainEvent,
  type DomainEventType,
  type VoiceSessionEndedEvent,
  type ModerationActionRecordedEvent,
  type TempVoiceEventRecordedEvent,
} from "./domain-events.js";
export { moderationIncidentSchema, type ModerationIncident } from "./moderation-incident.js";
export { LOCALES, type Locale, type LocaleMessages } from "./locale/index.js";
export { LOG_CATEGORIES, type LogCategory } from "./log-category.js";
export { MODERATION_ACTION_TYPES, type ModerationActionType } from "./moderation-action-type.js";
export { ACTION_SEVERITY } from "./moderation-action-severity.js";
export {
  MODERATION_VIOLATION_TYPES,
  MODERATION_ESCALATION_VIOLATION_TYPES,
  type ModerationViolationType,
  type ModerationEscalationViolationType,
} from "./moderation-violation-type.js";
export { MODERATION_PRESETS, type ModerationPreset } from "./moderation-preset.js";
export {
  LOG_ENTRY_SCHEMAS,
  messageLogEntrySchema,
  messageAttachmentSchema,
  bulkDeletedMessageSchema,
  reactionLogEntrySchema,
  memberLogEntrySchema,
  roleLogEntrySchema,
  channelLogEntrySchema,
  guildLogEntrySchema,
  threadLogEntrySchema,
  inviteLogEntrySchema,
  emojiLogEntrySchema,
  stickerLogEntrySchema,
  autoModLogEntrySchema,
  integrationLogEntrySchema,
  pollLogEntrySchema,
  scheduledEventLogEntrySchema,
  stageLogEntrySchema,
  auditLogCorrelationEntrySchema,
  moderationCaseLogEntrySchema,
  voiceLogEntrySchema,
  tempVoiceLogEntrySchema,
  VOICE_STATE_FLAG_NAMES,
  logEntrySchema,
  isBulkDeleteLogEntry,
  parseLogEntry,
  safeParseLogEntry,
  SENSITIVE_LOG_FIELDS,
  type LogEntry,
  type BulkDeleteLogEntry,
  type BulkDeletedMessage,
  type MessageAttachment,
  type VoiceStateFlagName,
} from "./log-entry.js";
export { getLogEntrySubjectId, getLogEntrySubjectField } from "./log-entry-subject.js";
export { CATEGORY_LABELS } from "./category-labels.js";
export {
  summarizeLogEntry,
  contentWithoutGifLinks,
  type LogEntrySummary,
  type LogEntryFieldChange,
  type LogEntryAttachment,
} from "./log-entry-summary.js";
export { formatLogMessage, NAME_MARKUP } from "./format-log-message.js";
export {
  CHANGE_FIELD_LABELS,
  CHANNEL_REFERENCE_CHANGE_FIELDS,
  formatChangeValue,
} from "./log-entry-changes.js";
export { buildInviteUrl } from "./invite-url.js";
export { createTtlCache } from "./ttl-cache.js";
export { mapWithConcurrency } from "./concurrency.js";
export { DISCORD_PERMISSION_LABELS, diffPermissions } from "./discord-permissions.js";
export { discordIdSchema } from "./discord-id.js";
export {
  TEMP_VOICE_CREATE_REASON,
  TEMP_VOICE_CONTROL_CREATE_REASON,
  TEMP_VOICE_DELETE_REASON,
  TEMP_VOICE_UPDATE_REASON,
  isTempVoiceAuditReason,
  suppressTempVoiceChannelLog,
  shouldSuppressTempVoiceChannelLog,
  suppressTempVoiceChannelCreateLog,
  shouldSuppressTempVoiceChannelCreateLog,
  suppressTempVoiceMoveLog,
  shouldSuppressTempVoiceMoveLog,
  type TempVoiceChannelCreateLogSuppression,
  type TempVoiceMoveLogSuppression,
} from "./log-suppression.js";
export { appEmojiNameFor } from "./app-emoji-name.js";
export { setAppEmojis, findAppEmoji, appEmojiText, type AppEmoji } from "./app-emoji.js";
export {
  INFRA_LOG_STREAM,
  INFRA_LOG_MAXLEN,
  INFRA_STATUS_KEY,
  INFRA_LOG_INGEST_CHANNEL,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_STALE_MS,
  INFRA_RESOURCES_KEY,
  RESOURCE_SAMPLE_INTERVAL_MS,
  RESOURCE_SAMPLE_MAXLEN,
  resourceSampleSchema,
  type ResourceSample,
  INFRA_LOG_SERVICES,
  INFRA_LOG_LEVELS,
  infraLogEntrySchema,
  infraHeartbeatSchema,
  formatConsoleArgs,
  appendInfraLog,
  startInfraReporter,
  type InfraLogService,
  type InfraLogLevel,
  type InfraLogEntry,
  type InfraHeartbeat,
  type InfraRedisClient,
  type InfraReporter,
} from "./infra-status.js";
