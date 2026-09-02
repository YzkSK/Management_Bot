import { logEntries } from "@management-bot/db";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { LogCategory } from "../domain/index.js";
import { writeLogEntry, type WriteLogEntryDeps } from "./write-log-entry.js";

/** discord層のGuildAuditLogsEntryから作る、discord.js非依存の入力。actionはAuditLogEventの名前(例: "ChannelDelete")。 */
export interface AuditLogEntryInfo {
  id: string;
  guildId: string;
  action: string;
  executorId: string | null;
  targetId: string | null;
  createdAt: string;
}

interface CorrelationRule {
  category: LogCategory;
  /** payload内で対象を一意に絞り込むフィールド名。null(guild等)はguildId+category+直近時刻のみで絞り込む。 */
  field: string | null;
  /**
   * payload.actionの期待値。これを条件に含めないと、同一対象への複数操作(例: 同じチャンネルへの
   * ChannelUpdate直後のChannelDelete)で新しい行に誤って古い監査ログの実行者を(あるいはその逆を)
   * 付けてしまう(codexレビュー指摘)。
   */
  logAction: string;
}

/**
 * AuditLogEvent名(discord.js/discord-api-typesの数値enumを文字列化したもの)→
 * 対応するログカテゴリ・対象フィールド・payload.actionの対応表。#49〜#51のイベント単体では
 * 実行者を取得できないカテゴリのみを対象にする。
 * 以下は対象外(過剰実装を避けるため誤相関リスクの高いものは相関しない):
 * - message/poll/autoMod実行結果: 対象(targetId)が投稿者ID等になり複数候補と衝突しやすい。
 * - MemberUpdate/ThreadUpdate/GuildScheduledEventUpdate: 1つの監査ログイベントが複数の
 *   payload.action(nicknameChange/timeout、update/archive/unarchive、start/complete/cancel/update)
 *   に対応し得て一意に決められない。
 * - role所属変更(MemberRoleUpdate): roleId+userIdの複合一致が必要で本テーブルの単一フィールド一致
 *   では表現できない。
 */
const CORRELATION_RULES: Partial<Record<string, CorrelationRule>> = {
  GuildUpdate: { category: "guild", field: null, logAction: "update" },
  ChannelCreate: { category: "channel", field: "channelId", logAction: "create" },
  ChannelUpdate: { category: "channel", field: "channelId", logAction: "update" },
  ChannelDelete: { category: "channel", field: "channelId", logAction: "delete" },
  MemberKick: { category: "member", field: "userId", logAction: "leave" },
  MemberBanAdd: { category: "member", field: "userId", logAction: "ban" },
  MemberBanRemove: { category: "member", field: "userId", logAction: "unban" },
  RoleCreate: { category: "role", field: "roleId", logAction: "create" },
  RoleUpdate: { category: "role", field: "roleId", logAction: "update" },
  RoleDelete: { category: "role", field: "roleId", logAction: "delete" },
  ThreadCreate: { category: "thread", field: "threadId", logAction: "create" },
  ThreadDelete: { category: "thread", field: "threadId", logAction: "delete" },
  InviteCreate: { category: "invite", field: "code", logAction: "create" },
  InviteDelete: { category: "invite", field: "code", logAction: "delete" },
  EmojiCreate: { category: "emoji", field: "emojiId", logAction: "create" },
  EmojiUpdate: { category: "emoji", field: "emojiId", logAction: "update" },
  EmojiDelete: { category: "emoji", field: "emojiId", logAction: "delete" },
  AutoModerationRuleCreate: { category: "autoMod", field: "ruleId", logAction: "ruleCreate" },
  AutoModerationRuleUpdate: { category: "autoMod", field: "ruleId", logAction: "ruleUpdate" },
  AutoModerationRuleDelete: { category: "autoMod", field: "ruleId", logAction: "ruleDelete" },
  GuildScheduledEventCreate: { category: "scheduledEvent", field: "eventId", logAction: "create" },
  GuildScheduledEventDelete: { category: "scheduledEvent", field: "eventId", logAction: "delete" },
  StageInstanceCreate: { category: "stage", field: "stageInstanceId", logAction: "start" },
  StageInstanceUpdate: { category: "stage", field: "stageInstanceId", logAction: "update" },
  StageInstanceDelete: { category: "stage", field: "stageInstanceId", logAction: "end" },
};

/**
 * discord.jsにintegration create/update/delete専用のgatewayイベントが存在しない
 * (guildIntegrationsUpdateはintegration idを含まない)ため、integrationカテゴリのログは
 * 既存行への追記ではなく監査ログを一次情報源として新規作成する(#51 handlers/integration.ts参照)。
 */
const INTEGRATION_ACTIONS: Partial<Record<string, "create" | "update" | "delete">> = {
  IntegrationCreate: "create",
  IntegrationUpdate: "update",
  IntegrationDelete: "delete",
};

/** 対象ログ行との突き合わせに使う時間窓。監査ログの配信は元イベントの直後だが、多少の遅延を許容する。 */
const CORRELATION_WINDOW_MS = 30_000;

/**
 * guildAuditLogEntryCreateを受けて (1) 生の監査ログをauditLogCorrelationカテゴリとして常に保存し、
 * (2) integrationカテゴリはこれを一次情報源として新規作成し、(3) それ以外は対応する既存ログ行に
 * executorIdを追記する。(1)はダッシュボードの通常表示には出さず、必要な時に参照する想定(表示側は本タスクのスコープ外)。
 *
 * ponytail: 元イベント(#49〜#51のgatewayイベント)側のwriteLogEntryも本関数もfire-and-forgetで
 * 非同期に書き込むため、監査ログが元イベントのINSERTより先にこの関数の(3)へ到達すると
 * 対象行がまだ存在せず相関漏れになり得る(再試行しない)。実運用でDiscordのAPI応答順序上は
 * 元イベント→監査ログの順で届くことが大半で許容できると判断。悪化するようなら、
 * 未相関の監査ログを一定時間後に再照合するバッチ処理を追加する。
 */
export async function correlateAuditLogEntry(deps: WriteLogEntryDeps, entry: AuditLogEntryInfo): Promise<void> {
  await writeLogEntry(
    deps,
    {
      category: "auditLogCorrelation",
      guildId: entry.guildId,
      createdAt: entry.createdAt,
      executorId: entry.executorId ?? undefined,
      auditLogEntryId: entry.id,
      targetId: entry.targetId ?? undefined,
      actionType: entry.action,
    },
    `auditLogCorrelation:${entry.id}`,
  );

  const integrationAction = INTEGRATION_ACTIONS[entry.action];
  if (integrationAction) {
    if (!entry.targetId) return;
    await writeLogEntry(
      deps,
      {
        category: "integration",
        guildId: entry.guildId,
        createdAt: entry.createdAt,
        integrationId: entry.targetId,
        executorId: entry.executorId ?? undefined,
        action: integrationAction,
      },
      `integration:${entry.id}`,
    );
    return;
  }

  if (!entry.executorId) return;
  const rule = CORRELATION_RULES[entry.action];
  if (!rule) return;
  if (rule.field && !entry.targetId) return;

  const auditAt = new Date(entry.createdAt);
  const windowStart = new Date(auditAt.getTime() - CORRELATION_WINDOW_MS);
  const windowEnd = new Date(auditAt.getTime() + CORRELATION_WINDOW_MS);
  const notYetCorrelated = sql`NOT (${logEntries.payload} ? 'executorId')`;
  const [match] = await deps.db
    .select({ id: logEntries.id })
    .from(logEntries)
    .where(
      and(
        eq(logEntries.guildId, entry.guildId),
        eq(logEntries.category, rule.category),
        gte(logEntries.createdAt, windowStart),
        lte(logEntries.createdAt, windowEnd),
        sql`${logEntries.payload} ->> 'action' = ${rule.logAction}`,
        notYetCorrelated,
        rule.field ? sql`${logEntries.payload} ->> ${rule.field} = ${entry.targetId}` : undefined,
      ),
    )
    .orderBy(desc(logEntries.createdAt))
    .limit(1);

  if (!match) return;

  await deps.db
    .update(logEntries)
    .set({ payload: sql`${logEntries.payload} || jsonb_build_object('executorId', ${entry.executorId}::text)` })
    .where(and(eq(logEntries.id, match.id), notYetCorrelated));
}
