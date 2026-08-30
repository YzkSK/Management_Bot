import type { Db } from "@management-bot/db";
import { isKnownCapabilityMask } from "@management-bot/shared";
import { initTRPC, TRPCError } from "@trpc/server";
import { validateSession } from "./session.js";
import { resolveEffectiveCapabilities } from "./effective-capabilities.js";

export interface GuildMembership {
  isOwner: boolean;
  roleIds: readonly string[];
}

export interface DashboardAccessContext {
  db: Db;
  sessionId: string | undefined;
  /**
   * guildIdにおけるdiscordUserIdの在籍状態を返す。非在籍(脱退・キック済み等)はnull。
   * dashboard-api側でDiscord APIやキャッシュから供給する。
   */
  getGuildMembership: (guildId: string, discordUserId: string) => Promise<GuildMembership | null>;
}

const t = initTRPC.context<DashboardAccessContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

interface AuthenticatedContext extends DashboardAccessContext {
  discordUserId: string;
}

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  const session = ctx.sessionId ? await validateSession(ctx.db, ctx.sessionId) : null;
  if (!session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  const authenticatedCtx: AuthenticatedContext = { ...ctx, discordUserId: session.discordUserId };
  return next({ ctx: authenticatedCtx });
});

/**
 * inputに`guildId`を要求し、そのギルドに在籍していない、またはcapを持たない場合はFORBIDDENを投げる。
 * これがassertGuildScope相当を兼ねる: 在籍確認を通らない限り他ギルドのデータには到達できない。
 * protectedProcedureの後に.use()すること(discordUserIdをctxから読む)。
 */
export function requireCapability(cap: number) {
  if (!isKnownCapabilityMask(cap) || cap === 0) {
    throw new Error("requireCapability requires a non-zero known capability mask");
  }

  return t.middleware(async ({ ctx, input, next }) => {
    const { db, discordUserId } = ctx as AuthenticatedContext;
    const parsed = input as { guildId?: unknown };
    if (typeof parsed?.guildId !== "string") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "guildId is required" });
    }
    const guildId = parsed.guildId;

    const membership = await (ctx as DashboardAccessContext).getGuildMembership(
      guildId,
      discordUserId,
    );
    if (!membership) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    const capabilities = await resolveEffectiveCapabilities(db, {
      guildId,
      discordUserId,
      isOwner: membership.isOwner,
      roleIds: membership.roleIds,
    });

    if ((capabilities & cap) !== cap) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    return next({ ctx });
  });
}
