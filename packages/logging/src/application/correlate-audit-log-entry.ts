import { logEntries } from "@management-bot/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
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
}

/**
 * AuditLogEvent名(discord.js/discord-api-typesの数値enumを文字列化したもの)→
 * 対応するログカテゴリ・対象フィールドの対応表。#49〜#51のイベント単体では実行者を取得できない
 * カテゴリのみを対象にする。message/poll/autoMod実行結果は対象(targetId)が投稿者ID等になり
 * 複数候補と衝突しやすいため相関対象外とする(誤相関のリスクが高い割に価値が低いため過剰実装を避ける)。
 * role所属変更(MemberRoleUpdate)はroleId+userIdの複合一致が必要で本テーブルの単一フィールド一致
 * では表現できないため対象外とする。
 */
const CORRELATION_RULES: Partial<Record<string, CorrelationRule>> = {
  GuildUpdate: { category: "guild", field: null },
  ChannelCreate: { category: "channel", field: "channelId" },
  ChannelUpdate: { category: "channel", field: "channelId" },
  ChannelDelete: { category: "channel", field: "channelId" },
  MemberKick: { category: "member", field: "userId" },
  MemberBanAdd: { category: "member", field: "userId" },
  MemberBanRemove: { category: "member", field: "userId" },
  MemberUpdate: { category: "member", field: "userId" },
  RoleCreate: { category: "role", field: "roleId" },
  RoleUpdate: { category: "role", field: "roleId" },
  RoleDelete: { category: "role", field: "roleId" },
  ThreadCreate: { category: "thread", field: "threadId" },
  ThreadUpdate: { category: "thread", field: "threadId" },
  ThreadDelete: { category: "thread", field: "threadId" },
  InviteCreate: { category: "invite", field: "code" },
  InviteDelete: { category: "invite", field: "code" },
  EmojiCreate: { category: "emoji", field: "emojiId" },
  EmojiUpdate: { category: "emoji", field: "emojiId" },
  EmojiDelete: { category: "emoji", field: "emojiId" },
  AutoModerationRuleCreate: { category: "autoMod", field: "ruleId" },
  AutoModerationRuleUpdate: { category: "autoMod", field: "ruleId" },
  AutoModerationRuleDelete: { category: "autoMod", field: "ruleId" },
  GuildScheduledEventCreate: { category: "scheduledEvent", field: "eventId" },
  GuildScheduledEventUpdate: { category: "scheduledEvent", field: "eventId" },
  GuildScheduledEventDelete: { category: "scheduledEvent", field: "eventId" },
  StageInstanceCreate: { category: "stage", field: "stageInstanceId" },
  StageInstanceUpdate: { category: "stage", field: "stageInstanceId" },
  StageInstanceDelete: { category: "stage", field: "stageInstanceId" },
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
 */
export async function correlateAuditLogEntry(deps: WriteLogEntryDeps, entry: AuditLogEntryInfo): Promise<void> {
  await writeLogEntry(
    deps,
    {
      category: "auditLogCorrelation",
      guildId: entry.guildId,
      createdAt: entry.createdAt,
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

  const cutoff = new Date(Date.parse(entry.createdAt) - CORRELATION_WINDOW_MS);
  const [match] = await deps.db
    .select({ id: logEntries.id })
    .from(logEntries)
    .where(
      and(
        eq(logEntries.guildId, entry.guildId),
        eq(logEntries.category, rule.category),
        gte(logEntries.createdAt, cutoff),
        rule.field ? sql`${logEntries.payload} ->> ${rule.field} = ${entry.targetId}` : undefined,
      ),
    )
    .orderBy(desc(logEntries.createdAt))
    .limit(1);

  if (!match) return;

  await deps.db
    .update(logEntries)
    .set({ payload: sql`${logEntries.payload} || jsonb_build_object('executorId', ${entry.executorId}::text)` })
    .where(eq(logEntries.id, match.id));
}
