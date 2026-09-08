import { CAPABILITIES, canGrantCapabilities, isKnownCapabilityMask } from "@management-bot/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  getCapabilityGrant,
  grantCapabilities,
  listCapabilityGrants,
  revokeCapabilityGrant,
  type CapabilityGrantTargetType,
} from "./capability-grants.js";
import type { DashboardAccessContext } from "./trpc.js";
import { protectedProcedure, requireCapability, router } from "./trpc.js";

const guildIdInput = z.object({ guildId: z.string().min(1) });

const targetTypeSchema = z.enum(["user", "role"]);

const grantCapabilitiesInput = z.object({
  guildId: z.string().min(1),
  targetType: targetTypeSchema,
  targetId: z.string().min(1),
  /** 0(無権限)でのgrantは意味を持たないため拒否する。剥奪はrevokeCapabilityGrantを使う。 */
  capabilities: z.number().int().positive(),
});

const revokeCapabilityGrantInput = z.object({
  guildId: z.string().min(1),
  targetType: targetTypeSchema,
  targetId: z.string().min(1),
});

const listMemberOptionsInput = z.object({
  guildId: z.string().min(1),
  /** 前回レスポンスのnextAfterをそのまま渡す不透明なカーソル。省略時は先頭ページ。 */
  after: z.string().min(1).optional(),
});

/**
 * targetがguild内に実在するかをサーバー側で検証する。Dashboard UIはセレクター経由でのみ
 * targetIdを渡す設計だが、tRPC呼び出し自体はクライアントの制約を経由しないため、
 * 存在しない/別guildのIDが誤って保存されないようserver側でも実在確認する(issue #198 codexレビュー対応)。
 * roleは`@everyone`(targetId===guildId)も許容する。userは対象guildへの在籍を要求する
 * (未在籍ユーザーへの事前付与は許可しない。在籍後に改めて付与する運用とする)。
 * どちらもキャッシュを介さない検証専用メソッド(verifyGuildRole/isGuildMember)を使う
 * (getGuildMembershipは「ログイン中の操作者自身」の在籍確認専用であり、任意のtargetの
 * 実在検証には使えないため転用しない)。
 */
async function assertGrantTargetExists(
  ctx: DashboardAccessContext,
  guildId: string,
  targetType: CapabilityGrantTargetType,
  targetId: string,
): Promise<void> {
  if (targetType === "role") {
    if (targetId === guildId) {
      return;
    }
    if (!(await ctx.verifyGuildRole(guildId, targetId))) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "targetId is not a role of this guild" });
    }
    return;
  }
  if (!(await ctx.isGuildMember(guildId, targetId))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "targetId is not a member of this guild" });
  }
}

/**
 * capability grantのCRUDを提供するrouter(issue #198)。全procedureがMANAGE_ACCESSを要求する。
 * 付与・剥奪はどちらもcanGrantCapabilitiesで、操作対象のcapabilitiesが操作者自身の実効capabilities
 * (ctx.capabilities、requireCapabilityミドルウェアが計算する)の部分集合であることを要求し、
 * 「自分が持たない権限を他者に付与/剥奪できてしまう」昇格を防止する。
 */
export const capabilityGrantsRouter = router({
  listCapabilityGrants: protectedProcedure
    .input(guildIdInput)
    .use(requireCapability(CAPABILITIES.MANAGE_ACCESS))
    .query(({ ctx, input }) => listCapabilityGrants(ctx.db, input.guildId)),

  /** Dashboard UIでのID直接入力を禁止するため、選択肢(実在ロール)をこのprocedure経由で提供する。 */
  listRoleOptions: protectedProcedure
    .input(guildIdInput)
    .use(requireCapability(CAPABILITIES.MANAGE_ACCESS))
    .query(({ ctx, input }) => ctx.getGuildRoles(input.guildId)),

  /** Dashboard UIでのID直接入力を禁止するため、選択肢(実在メンバー)をこのprocedure経由で提供する。 */
  listMemberOptions: protectedProcedure
    .input(listMemberOptionsInput)
    .use(requireCapability(CAPABILITIES.MANAGE_ACCESS))
    .query(({ ctx, input }) => ctx.getGuildMembersPage(input.guildId, input.after)),

  grantCapabilities: protectedProcedure
    .input(grantCapabilitiesInput)
    .use(requireCapability(CAPABILITIES.MANAGE_ACCESS))
    .mutation(async ({ ctx, input }) => {
      if (!isKnownCapabilityMask(input.capabilities)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "capabilities contains unknown bits" });
      }
      if (!canGrantCapabilities(ctx.capabilities, input.capabilities)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "cannot grant capabilities you do not have yourself",
        });
      }
      // grantは実態が置換(upsert)のため、既存grantのcapabilitiesも操作者の保有範囲内かを
      // 確認する。確認しないと、既存grantに操作者が持たないbitが含まれる場合、新しいcapabilities
      // で上書きすることでそのbitを意図せず剥奪できてしまう(issue #198 codexレビュー対応)。
      const existing = await getCapabilityGrant(ctx.db, {
        guildId: input.guildId,
        targetType: input.targetType,
        targetId: input.targetId,
      });
      if (existing && !canGrantCapabilities(ctx.capabilities, existing.capabilities)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "cannot overwrite a grant that includes capabilities you do not have yourself",
        });
      }
      await assertGrantTargetExists(ctx, input.guildId, input.targetType, input.targetId);
      await grantCapabilities(ctx.db, input);
    }),

  revokeCapabilityGrant: protectedProcedure
    .input(revokeCapabilityGrantInput)
    .use(requireCapability(CAPABILITIES.MANAGE_ACCESS))
    .mutation(async ({ ctx, input }) => {
      const existing = await getCapabilityGrant(ctx.db, input);
      if (!existing) {
        return;
      }
      if (!canGrantCapabilities(ctx.capabilities, existing.capabilities)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "cannot revoke capabilities you do not have yourself",
        });
      }
      await revokeCapabilityGrant(ctx.db, input);
    }),
});
