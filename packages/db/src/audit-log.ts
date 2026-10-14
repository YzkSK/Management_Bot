import { randomUUID } from "node:crypto";
import { and, eq, sql, type TablesRelationalConfig } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type { Db } from "./client.js";
import { auditLogs } from "./schema/index.js";

export type AuditLogKind = "action" | "access";
export type AuditLogOutcome = "pending" | "success" | "failure" | "denied";

export interface AuditLogEntry {
  guildId: string;
  kind: AuditLogKind;
  /** NULLはBot自身の自動操作。 */
  actorId: string | null;
  actorName: string;
  feature: string;
  action: string;
  outcome: AuditLogOutcome;
  before?: unknown;
  after?: unknown;
}

const SECRET_KEY_PATTERN = /secret|token|password|webhook/i;

/** オブジェクトを再帰的に辿り、秘密情報らしいキー(secret/token/password/webhook)の値を"***"にする。 */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, SECRET_KEY_PATTERN.test(key) ? "***" : redactSecrets(v)]),
    );
  }
  return value;
}

/** undefinedはSQL NULLにする。JSON化できない値(bigint等)は呼び出し側の責務。 */
function toJsonb(value: unknown): unknown {
  return value === undefined || value === null ? null : redactSecrets(value);
}

/** 履歴を1行追記してidを返す。before/afterには必ずredactSecretsを適用する。 */
export async function recordAuditLog(db: Db, entry: AuditLogEntry): Promise<string> {
  const id = randomUUID();
  await db.insert(auditLogs).values({
    id,
    guildId: entry.guildId,
    kind: entry.kind,
    actorId: entry.actorId,
    actorName: entry.actorName,
    feature: entry.feature,
    action: entry.action,
    outcome: entry.outcome,
    before: toJsonb(entry.before),
    after: toJsonb(entry.after),
  });
  return id;
}

/** pendingの行を確定結果に更新する(DBトリガーが許すのはこの1回のoutcome更新とbeforeの補完のみ)。 */
export async function completeAuditLog(
  db: Db,
  id: string,
  outcome: Exclude<AuditLogOutcome, "pending">,
  before?: unknown,
): Promise<void> {
  await db
    .update(auditLogs)
    .set(before === undefined ? { outcome } : { outcome, before: toJsonb(before) })
    .where(and(eq(auditLogs.id, id), eq(auditLogs.outcome, "pending")));
}

/** 保存期間切れの行を削除する(トリガーが許す唯一のDELETE)。通常のdb・transactionどちらも受け取る。削除件数を返す。 */
export async function purgeExpiredAuditLogs<
  TFullSchema extends Record<string, unknown>,
  TSchema extends TablesRelationalConfig,
>(db: PgDatabase<PostgresJsQueryResultHKT, TFullSchema, TSchema>): Promise<number> {
  // 期限はトリガー(0037)と同じSQLの式で判定する(1 yearは暦ベースで365日と一致しない年があるため)。
  const rows = await db.execute(sql`
    DELETE FROM ${auditLogs}
    WHERE (${auditLogs.kind} = 'action' AND ${auditLogs.createdAt} < now() - interval '1 year')
       OR (${auditLogs.kind} = 'access' AND ${auditLogs.createdAt} < now() - interval '90 days')
    RETURNING ${auditLogs.id}
  `);
  return rows.length;
}
