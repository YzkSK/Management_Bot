import { randomUUID } from "node:crypto";
import { auditLogs, type Db } from "@management-bot/db";
import { CAPABILITIES, discordIdSchema } from "@management-bot/shared";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, gte, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { collectAuditIds, resolveAuditNames } from "./audit-names.js";
import {
  protectedProcedure,
  requireCapability,
  resolveActorName,
  router,
  type AuthenticatedContext,
} from "./trpc.js";

/** 同じ人・同じギルドのアクセス履歴をこの間隔で1件にまとめる。 */
const ACCESS_DEDUPE_MINUTES = 30;
const MAX_ACTOR_OPTIONS = 500;

const guildIdInput = z.object({ guildId: discordIdSchema });

const listInput = z.object({
  guildId: discordIdSchema,
  actorId: discordIdSchema.optional(),
  feature: z.string().min(1).max(100).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  hideAccess: z.boolean().default(false),
  /** 失敗・権限不足・結果不明(pending)の操作のみ。アクセス履歴は含めない。 */
  onlyIssues: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(50),
  /** 先頭から読み飛ばす件数(logging.listLogEntriesと同じ方式)。 */
  offset: z.number().int().min(0).default(0),
});

const viewAuditLogProcedure = <TInput extends z.ZodType<{ guildId: string }>>(input: TInput) =>
  protectedProcedure.input(input).use(requireCapability(CAPABILITIES.VIEW_AUDIT_LOG));

export type ListAuditLogsInput = z.infer<typeof listInput>;

export async function listAuditLogs(db: Db, input: ListAuditLogsInput) {
  const where = and(
    eq(auditLogs.guildId, input.guildId),
    input.actorId ? eq(auditLogs.actorId, input.actorId) : undefined,
    input.feature ? eq(auditLogs.feature, input.feature) : undefined,
    input.from ? gte(auditLogs.createdAt, new Date(input.from)) : undefined,
    input.to ? lt(auditLogs.createdAt, new Date(input.to)) : undefined,
    input.hideAccess ? ne(auditLogs.kind, "access") : undefined,
    input.onlyIssues
      ? and(eq(auditLogs.kind, "action"), inArray(auditLogs.outcome, ["failure", "denied", "pending"]))
      : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(input.limit)
      .offset(input.offset),
    db.select({ value: count() }).from(auditLogs).where(where),
  ]);
  return { entries: rows, totalCount: total?.value ?? 0 };
}

/** そのギルドの履歴に現れる操作者(最新の表示名)と機能の一覧。UIのセレクター用。 */
export async function listAuditLogFilterOptions(db: Db, guildId: string) {
  const [actors, features] = await Promise.all([
    db
      .selectDistinctOn([auditLogs.actorId], { id: auditLogs.actorId, name: auditLogs.actorName })
      .from(auditLogs)
      .where(and(eq(auditLogs.guildId, guildId), isNotNull(auditLogs.actorId)))
      .orderBy(auditLogs.actorId, desc(auditLogs.createdAt))
      .limit(MAX_ACTOR_OPTIONS),
    db
      .selectDistinct({ feature: auditLogs.feature })
      .from(auditLogs)
      .where(eq(auditLogs.guildId, guildId))
      .orderBy(auditLogs.feature),
  ]);
  return {
    actors: actors.flatMap((a) => (a.id === null ? [] : [{ id: a.id, name: a.name }])),
    features: features.map((f) => f.feature),
  };
}

/** 直近ACCESS_DEDUPE_MINUTES分以内に同一actor・guildのアクセス履歴が無ければ1件記録する。記録したらtrue。 */
export async function recordAccessIfNeeded(
  ctx: AuthenticatedContext,
  guildId: string,
): Promise<boolean> {
  const actorName = await resolveActorName(ctx, guildId);
  // 同時リクエスト(複数タブ等)で確認と追記が競合しないよう、actor・guild単位のadvisory lockで直列化する。
  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`audit-access:${guildId}:${ctx.discordUserId}`}))`);
    const [recent] = await tx
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.guildId, guildId),
          eq(auditLogs.kind, "access"),
          eq(auditLogs.actorId, ctx.discordUserId),
          gte(auditLogs.createdAt, sql`now() - make_interval(mins => ${ACCESS_DEDUPE_MINUTES})`),
        ),
      )
      .limit(1);
    if (recent) return false;
    await tx.insert(auditLogs).values({
      id: randomUUID(),
      guildId,
      kind: "access",
      actorId: ctx.discordUserId,
      actorName,
      feature: "dashboard",
      action: "open",
      outcome: "success",
    });
    return true;
  });
}

export const auditLogRouter = router({
  /**
   * ギルドの管理画面を開いたことを記録する(アクセス履歴)。操作履歴の対象ではないためrequireCapabilityは
   * 使わず、在籍確認のみ行う(在籍していない人が任意のguildIdで行を作れないようにする)。
   */
  recordAccess: protectedProcedure.input(guildIdInput).mutation(async ({ ctx, input }) => {
    const membership = await ctx.getGuildMembership(input.guildId, ctx.discordUserId);
    if (!membership) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    await recordAccessIfNeeded(ctx, input.guildId);
  }),

  /** `names`は変更内容に含まれるチャンネル/ロール/ユーザーのID→表示名(解決できたものだけ)。 */
  list: viewAuditLogProcedure(listInput).query(async ({ ctx, input }) => {
    const result = await listAuditLogs(ctx.db, input);
    const ids = collectAuditIds(result.entries.flatMap((entry) => [entry.before, entry.after]));
    return { ...result, names: await resolveAuditNames(ctx, input.guildId, ids) };
  }),

  listFilterOptions: viewAuditLogProcedure(guildIdInput).query(({ ctx, input }) =>
    listAuditLogFilterOptions(ctx.db, input.guildId),
  ),
});
