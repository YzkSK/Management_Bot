import type { Db } from "@management-bot/db";
import { logEntries } from "@management-bot/db";
import { and, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import type { LogCategory } from "../domain/index.js";
import { writeLogEntry, type WriteLogEntryDeps } from "./write-log-entry.js";

/**
 * discord層のGuildAuditLogsEntryから作る、discord.js非依存の入力。actionはAuditLogEventの名前(例: "ChannelDelete")。
 * roleChangesはMemberRoleUpdate限定で、audit log entryのchanges($add/$remove)から抽出したroleIdの集合。
 */
export interface AuditLogEntryInfo {
  id: string;
  guildId: string;
  action: string;
  executorId: string | null;
  targetId: string | null;
  createdAt: string;
  roleChanges?: { added: string[]; removed: string[] };
}

interface CorrelationRule {
  category: LogCategory;
  /** payload内で対象を一意に絞り込むフィールド名。null(guild等)はguildId+category+直近時刻のみで絞り込む。 */
  field: string | null;
  /**
   * payload.actionの期待候補(いずれかに一致すればよい)。これを条件に含めないと、同一対象への
   * 複数操作(例: 同じチャンネルへのChannelUpdate直後のChannelDelete)で新しい行に誤って
   * 古い監査ログの実行者を付けてしまう(codexレビュー指摘)。
   * ThreadUpdate/MemberUpdate/GuildScheduledEventUpdateのように1つの監査ログイベントが
   * 複数のpayload.actionに対応し得るものは、候補を複数列挙することでカバーする
   * (誤り: 対象自体を相関から外していたが、時間窓+対象ID一致で十分絞り込めるため候補群方式に変更)。
   */
  logActions: readonly string[];
  /**
   * 相関時にpayload.actionをこの値へ書き換える(例: MemberKick相関時にleave→kick)。
   * 実行者だけでなく「実際は何が起きたか」もこの監査ログから初めて分かるケース用。
   */
  rewriteAction?: string;
}

/**
 * AuditLogEvent名(discord.js/discord-api-typesの数値enumを文字列化したもの)→
 * 対応するログカテゴリ・対象フィールド・payload.action候補の対応表。#49〜#51のイベント単体では
 * 実行者を取得できないカテゴリのみを対象にする。
 * message/poll/autoMod実行結果は対象(targetId)が投稿者ID等になり複数候補と衝突しやすいため対象外
 * (誤相関リスクの高いものは相関しない、過剰実装を避ける)。
 * role所属変更(MemberRoleUpdate)はroleId+userIdの複合一致が必要でこのテーブルの単一フィールド
 * 一致では表現できないため、correlateAuditLogEntry内で別処理として扱う。
 */
const CORRELATION_RULES: Partial<Record<string, CorrelationRule>> = {
  GuildUpdate: { category: "guild", field: null, logActions: ["update"] },
  ChannelCreate: { category: "channel", field: "channelId", logActions: ["create"] },
  ChannelUpdate: { category: "channel", field: "channelId", logActions: ["update"] },
  ChannelDelete: { category: "channel", field: "channelId", logActions: ["delete"] },
  MemberKick: { category: "member", field: "userId", logActions: ["leave"], rewriteAction: "kick" },
  MemberBanAdd: { category: "member", field: "userId", logActions: ["ban"] },
  MemberBanRemove: { category: "member", field: "userId", logActions: ["unban"] },
  MemberUpdate: { category: "member", field: "userId", logActions: ["nicknameChange", "timeout"] },
  RoleCreate: { category: "role", field: "roleId", logActions: ["create"] },
  RoleUpdate: { category: "role", field: "roleId", logActions: ["update"] },
  RoleDelete: { category: "role", field: "roleId", logActions: ["delete"] },
  ThreadCreate: { category: "thread", field: "threadId", logActions: ["create"] },
  ThreadUpdate: { category: "thread", field: "threadId", logActions: ["update", "archive", "unarchive"] },
  ThreadDelete: { category: "thread", field: "threadId", logActions: ["delete"] },
  InviteCreate: { category: "invite", field: "code", logActions: ["create"] },
  InviteDelete: { category: "invite", field: "code", logActions: ["delete"] },
  EmojiCreate: { category: "emoji", field: "emojiId", logActions: ["create"] },
  EmojiUpdate: { category: "emoji", field: "emojiId", logActions: ["update"] },
  EmojiDelete: { category: "emoji", field: "emojiId", logActions: ["delete"] },
  AutoModerationRuleCreate: { category: "autoMod", field: "ruleId", logActions: ["ruleCreate"] },
  AutoModerationRuleUpdate: { category: "autoMod", field: "ruleId", logActions: ["ruleUpdate"] },
  AutoModerationRuleDelete: { category: "autoMod", field: "ruleId", logActions: ["ruleDelete"] },
  GuildScheduledEventCreate: { category: "scheduledEvent", field: "eventId", logActions: ["create"] },
  GuildScheduledEventUpdate: {
    category: "scheduledEvent",
    field: "eventId",
    logActions: ["update", "start", "complete", "cancel"],
  },
  GuildScheduledEventDelete: { category: "scheduledEvent", field: "eventId", logActions: ["delete"] },
  StageInstanceCreate: { category: "stage", field: "stageInstanceId", logActions: ["start"] },
  StageInstanceUpdate: { category: "stage", field: "stageInstanceId", logActions: ["update"] },
  StageInstanceDelete: { category: "stage", field: "stageInstanceId", logActions: ["end"] },
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
 * 元イベント側のwriteLogEntry(#49〜#51)がまだINSERTを終えていないタイミングで監査ログが
 * 先に届いた場合の取りこぼしを緩和するため、1回だけ短い遅延を空けて再検索する。
 * ponytail: 2回目も見つからなければ諦める(バッチ再照合等の恒久対応はしない)。
 * 大半のケースは元イベント→監査ログの順で届くため、1回のリトライで十分実用的と判断。
 */
const RETRY_DELAY_MS = 2_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface MatchCriteria {
  guildId: string;
  category: LogCategory;
  /** 監査ログの発生時刻。時間窓の中心であり、複数候補がある場合はこれに最も近い行を選ぶ基準にもなる。 */
  auditAt: Date;
  windowStart: Date;
  windowEnd: Date;
  extraConditions: SQL[];
}

interface CorrelationJob {
  criteria: MatchCriteria;
  rewriteAction?: string;
}

/**
 * `= ANY(${array}::text[])`はpostgres.js経由だと配列が個別スカラーパラメータの並び(タプル)として
 * 送られてしまい、text[]へのキャストに失敗する(実DBテストで発覚)。`IN (...)`はsql.joinで
 * 要素ごとに別パラメータとして正しく展開されるため、配列一致にはこちらを使う。
 */
function actionIn(candidates: readonly string[]): SQL {
  return sql`${logEntries.payload} ->> 'action' IN (${sql.join(
    candidates.map((action) => sql`${action}`),
    sql.raw(", "),
  )})`;
}

/**
 * 候補action(logActions)を複数許容するルール(ThreadUpdate等)では、時間窓内に同一対象への
 * 異なる操作が複数存在し得る(例: 同じユーザーへnicknameChange直後にtimeout)。
 * 単純に「最新の行」を選ぶと、後から届いた別操作の監査ログが先の行に誤って実行者を付けてしまうため、
 * 監査ログの発生時刻(auditAt)に最も近い行を優先する(codexレビュー指摘)。
 * excludeIdsは、選んだ候補行への注釈(annotateRow)が他の並行イベントに競り負けた場合の
 * リトライで、同じ行を選び直さないために使う(coderabbitレビュー指摘)。
 */
async function findUnannotatedRow(db: Db, criteria: MatchCriteria, excludeIds: readonly string[]): Promise<{ id: string } | undefined> {
  const [match] = await db
    .select({ id: logEntries.id })
    .from(logEntries)
    .where(
      and(
        eq(logEntries.guildId, criteria.guildId),
        eq(logEntries.category, criteria.category),
        gte(logEntries.createdAt, criteria.windowStart),
        lte(logEntries.createdAt, criteria.windowEnd),
        sql`NOT (${logEntries.payload} ? 'executorId')`,
        ...(excludeIds.length > 0 ? [sql`${logEntries.id} NOT IN (${sql.join(excludeIds.map((id) => sql`${id}`), sql.raw(", "))})`] : []),
        ...criteria.extraConditions,
      ),
    )
    .orderBy(sql`abs(extract(epoch from (${logEntries.createdAt} - ${criteria.auditAt.toISOString()}::timestamptz)))`)
    .limit(1);
  return match;
}

/**
 * WHERE条件(該当id かつ executorId未設定)に一致した行があった場合のみUPDATEが成立する。
 * 候補選択(findUnannotatedRow)からこのUPDATEまでの間に、並行する別イベントの
 * annotateRowが同じ行を先に確定させていると0件更新になり得るため、戻り値のreturningで
 * 実際に更新できたかを呼び出し元に返す(coderabbitレビュー指摘: 従来はここを見ずに
 * 「候補が見つかった=相関成功」とみなしていたため、競り負けたジョブは実行者を失っていた)。
 */
async function annotateRow(db: Db, id: string, executorId: string, rewriteAction?: string): Promise<boolean> {
  const patch = rewriteAction
    ? sql`jsonb_build_object('executorId', ${executorId}::text, 'action', ${rewriteAction}::text)`
    : sql`jsonb_build_object('executorId', ${executorId}::text)`;
  const updated = await db
    .update(logEntries)
    .set({ payload: sql`${logEntries.payload} || ${patch}` })
    .where(and(eq(logEntries.id, id), sql`NOT (${logEntries.payload} ? 'executorId')`))
    .returning({ id: logEntries.id });
  return updated.length > 0;
}

/**
 * 候補選択とannotateRowをセットで1回試し、失敗(候補なし、または競り負け)ならexcludeIdsに
 * 競り負けた行を積んで呼び出し元へfalseを返す。
 */
async function claimRow(
  db: Db,
  executorId: string,
  job: CorrelationJob,
  excludeIds: string[],
): Promise<boolean> {
  const match = await findUnannotatedRow(db, job.criteria, excludeIds);
  if (!match) return false;
  const success = await annotateRow(db, match.id, executorId, job.rewriteAction);
  if (!success) excludeIds.push(match.id);
  return success;
}

/**
 * jobsをまとめて1回だけ試行し、失敗した分(未着手・競り負け問わず)だけ1回リトライする(codexレビュー指摘:
 * MemberRoleUpdateでロール数ぶん直列に2秒待つと最大数十秒かかっていた不具合の修正。
 * イベント全体で「最大1回、2秒」のリトライに揃える)。
 */
async function correlateJobs(db: Db, executorId: string, jobs: CorrelationJob[], retryDelayMs: number): Promise<void> {
  if (jobs.length === 0) return;

  const excludeIds: string[][] = jobs.map(() => []);
  let results = await Promise.all(jobs.map((job, i) => claimRow(db, executorId, job, excludeIds[i]!)));
  if (results.some((success) => !success)) {
    await delay(retryDelayMs);
    results = await Promise.all(
      jobs.map((job, i) => (results[i] ? Promise.resolve(true) : claimRow(db, executorId, job, excludeIds[i]!))),
    );
  }
}

/**
 * guildAuditLogEntryCreateを受けて (1) 生の監査ログをauditLogCorrelationカテゴリとして常に保存し、
 * (2) integrationカテゴリはこれを一次情報源として新規作成し、(3) role所属変更(MemberRoleUpdate)は
 * roleId+userIdで対応するrole行にexecutorIdを追記し、(4) それ以外は対応する既存ログ行に
 * executorId(必要ならactionも)を追記する。(1)はダッシュボードの通常表示には出さず、
 * 必要な時に参照する想定(表示側は本タスクのスコープ外)。
 */
export async function correlateAuditLogEntry(
  deps: WriteLogEntryDeps,
  entry: AuditLogEntryInfo,
  retryDelayMs: number = RETRY_DELAY_MS,
): Promise<void> {
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

  if (!entry.executorId) return;

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
        executorId: entry.executorId,
        action: integrationAction,
      },
      `integration:${entry.id}`,
    );
    return;
  }

  const auditAt = new Date(entry.createdAt);
  const windowStart = new Date(auditAt.getTime() - CORRELATION_WINDOW_MS);
  const windowEnd = new Date(auditAt.getTime() + CORRELATION_WINDOW_MS);

  if (entry.action === "MemberRoleUpdate") {
    if (!entry.targetId || !entry.roleChanges) return;
    const userId = entry.targetId;
    const roleJob = (roleId: string, logAction: "memberAdd" | "memberRemove"): CorrelationJob => ({
      criteria: {
        guildId: entry.guildId,
        category: "role",
        auditAt,
        windowStart,
        windowEnd,
        extraConditions: [
          sql`${logEntries.payload} ->> 'action' = ${logAction}`,
          sql`${logEntries.payload} ->> 'roleId' = ${roleId}`,
          sql`${logEntries.payload} ->> 'userId' = ${userId}`,
        ],
      },
    });
    const jobs = [
      ...entry.roleChanges.added.map((roleId) => roleJob(roleId, "memberAdd")),
      ...entry.roleChanges.removed.map((roleId) => roleJob(roleId, "memberRemove")),
    ];
    await correlateJobs(deps.db, entry.executorId, jobs, retryDelayMs);
    return;
  }

  const rule = CORRELATION_RULES[entry.action];
  if (!rule) return;
  if (rule.field && !entry.targetId) return;

  await correlateJobs(
    deps.db,
    entry.executorId,
    [
      {
        criteria: {
          guildId: entry.guildId,
          category: rule.category,
          auditAt,
          windowStart,
          windowEnd,
          extraConditions: [
            actionIn(rule.logActions),
            ...(rule.field ? [sql`${logEntries.payload} ->> ${rule.field} = ${entry.targetId}`] : []),
          ],
        },
        rewriteAction: rule.rewriteAction,
      },
    ],
    retryDelayMs,
  );
}
