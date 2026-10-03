import { protectedProcedure, router } from "@management-bot/dashboard-access";
import { sessions, statusViewers, type Db } from "@management-bot/db";
import {
  discordIdSchema,
  INFRA_LOG_MAXLEN,
  INFRA_LOG_SERVICES,
  type InfraLogEntry,
  type ResourceSample,
} from "@management-bot/shared";
import { TRPCError } from "@trpc/server";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { BotOwner } from "../discord/bot-client.js";
import type { StatusOverview } from "../status/collect-status.js";
import type { ResourceRange } from "../status/resources.js";

export interface StatusDeps {
  getBotOwners: () => Promise<readonly BotOwner[]>;
  collectStatus: () => Promise<StatusOverview>;
  readLogs: (service: (typeof INFRA_LOG_SERVICES)[number] | undefined) => Promise<InfraLogEntry[]>;
  readResources: (range: ResourceRange) => Promise<ResourceSample[]>;
}

export type StatusAccess = "owner" | "viewer" | null;

/**
 * Bot全体ステータス画面(issue #507)の閲覧可否。オーナー判定(Discord API)に失敗した場合は
 * 閲覧不可に倒す(存在を隠す方針のため、エラーで画面を壊さず404相当にする)。
 */
export async function resolveStatusAccess(db: Db, deps: StatusDeps, discordUserId: string): Promise<StatusAccess> {
  const owners = await deps.getBotOwners().catch((error: unknown) => {
    console.error("Failed to fetch bot owners", error);
    return [];
  });
  if (owners.some((owner) => owner.id === discordUserId)) return "owner";
  const [viewer] = await db
    .select({ id: statusViewers.discordUserId })
    .from(statusViewers)
    .where(eq(statusViewers.discordUserId, discordUserId));
  return viewer ? "viewer" : null;
}

export function createStatusRouter(deps: StatusDeps) {
  // 閲覧できない人にはFORBIDDENでなくNOT_FOUNDを返し、画面の存在自体を隠す。
  const viewerProcedure = protectedProcedure.use(async ({ ctx, next }) => {
    const access = await resolveStatusAccess(ctx.db, deps, ctx.discordUserId);
    if (!access) throw new TRPCError({ code: "NOT_FOUND" });
    return next({ ctx: { ...ctx, statusAccess: access } });
  });
  const ownerProcedure = viewerProcedure.use(({ ctx, next }) => {
    if (ctx.statusAccess !== "owner") throw new TRPCError({ code: "NOT_FOUND" });
    return next();
  });

  return router({
    overview: viewerProcedure.query(() => deps.collectStatus()),

    logs: viewerProcedure
      .input(z.object({ service: z.enum(INFRA_LOG_SERVICES).optional() }))
      .query(async ({ input }) => ({ entries: await deps.readLogs(input.service), retained: INFRA_LOG_MAXLEN })),

    resources: viewerProcedure
      .input(z.object({ range: z.enum(["1h", "24h", "7d"]) }))
      .query(async ({ input }) => ({ samples: await deps.readResources(input.range) })),

    viewers: ownerProcedure.query(async ({ ctx }) => {
      const [owners, viewers] = await Promise.all([
        deps.getBotOwners(),
        ctx.db
          .select({ id: statusViewers.discordUserId, name: statusViewers.discordUsername })
          .from(statusViewers)
          .orderBy(asc(statusViewers.createdAt)),
      ]);
      return { owners, viewers };
    }),

    /**
     * 追加候補はダッシュボードにログインしたことのあるユーザー(ID直接入力を避けセレクターで選ばせるため)。
     * セッション清掃で消えたユーザーは、再ログインするまで候補に出ない。
     */
    viewerCandidates: ownerProcedure.query(async ({ ctx }) => {
      const [owners, viewers, rows] = await Promise.all([
        deps.getBotOwners(),
        ctx.db.select({ id: statusViewers.discordUserId }).from(statusViewers),
        ctx.db
          .select({ id: sessions.discordUserId, name: sessions.discordUsername })
          .from(sessions)
          .orderBy(desc(sessions.createdAt)),
      ]);
      const excluded = new Set([...owners.map((o) => o.id), ...viewers.map((v) => v.id)]);
      const candidates = new Map<string, string>();
      for (const row of rows) {
        if (!excluded.has(row.id) && !candidates.has(row.id)) candidates.set(row.id, row.name);
      }
      return [...candidates].map(([id, name]) => ({ id, name }));
    }),

    addViewer: ownerProcedure.input(z.object({ discordUserId: discordIdSchema })).mutation(async ({ ctx, input }) => {
      const [candidate] = await ctx.db
        .select({ name: sessions.discordUsername })
        .from(sessions)
        .where(eq(sessions.discordUserId, input.discordUserId))
        .orderBy(desc(sessions.createdAt))
        .limit(1);
      if (!candidate) throw new TRPCError({ code: "BAD_REQUEST", message: "unknown user" });
      await ctx.db
        .insert(statusViewers)
        .values({ discordUserId: input.discordUserId, discordUsername: candidate.name })
        .onConflictDoNothing();
    }),

    removeViewer: ownerProcedure.input(z.object({ discordUserId: discordIdSchema })).mutation(async ({ ctx, input }) => {
      await ctx.db.delete(statusViewers).where(eq(statusViewers.discordUserId, input.discordUserId));
    }),
  });
}
