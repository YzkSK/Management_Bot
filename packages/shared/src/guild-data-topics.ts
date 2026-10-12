import { z } from "zod";
import { CAPABILITIES } from "./capabilities.js";

/**
 * Dashboardのリアルタイム更新(issue #643)の通知種別。DBトリガー(pg_notify 'guild_data_changed')・
 * dashboard-apiの/ws/guild/:guildId・dashboard-webのinvalidateが共通で使う。
 */
export const GUILD_DATA_TOPICS = [
  "auditLog",
  "scheduledPost",
  "tempVoice",
  "moderation",
  "loggingSettings",
  "access",
] as const;

export const guildDataTopicSchema = z.enum(GUILD_DATA_TOPICS);

export type GuildDataTopic = z.infer<typeof guildDataTopicSchema>;

/**
 * topicの通知を受け取るのに必要なcapability(0は在籍していれば誰でも可)。
 * 通知は「再取得のきっかけ」だけで本文を含まないため、閲覧用のcapabilityで足りる
 * (データ本体はtRPC側の認可で守られる)。
 */
export const GUILD_DATA_TOPIC_CAPABILITY: Record<GuildDataTopic, number> = {
  auditLog: CAPABILITIES.VIEW_AUDIT_LOG,
  scheduledPost: 0,
  tempVoice: CAPABILITIES.VIEW_TEMP_VOICE,
  moderation: CAPABILITIES.MANAGE_MODERATION,
  loggingSettings: CAPABILITIES.VIEW_LOGS,
  // 権限の変更は、付与・剥奪された本人(MANAGE_ACCESSを持たない人を含む)のサイドバー・閲覧可能ページを
  // 更新させるため全メンバーに届ける。本文は含まず「権限が何か変わった」以上のことは分からない。
  access: 0,
};

/** /ws/guild/:guildId で流すメッセージ。 */
export const guildDataChangedMessageSchema = z.object({
  type: z.literal("changed"),
  topic: guildDataTopicSchema,
});
