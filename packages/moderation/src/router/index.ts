import { protectedProcedure, requireCapability, router } from "@management-bot/dashboard-access";
import {
  buildInviteUrl,
  CAPABILITIES,
  discordIdSchema,
  MODERATION_VIOLATION_TYPES,
} from "@management-bot/shared";
import { TRPCError } from "@trpc/server";
import { PermissionFlagsBits } from "discord.js";
import { z } from "zod";
import {
  addToWhitelist,
  listThresholds,
  listWhitelist,
  removeFromWhitelist,
  setThreshold,
} from "../application/index.js";
import { MODERATION_PRESETS } from "../domain/index.js";
import { MODERATION_REQUIRED_PERMISSIONS } from "../discord/required-permissions.js";

const guildIdInput = z.object({ guildId: discordIdSchema });

const violationTypeSchema = z.enum(MODERATION_VIOLATION_TYPES);
const presetSchema = z.enum(MODERATION_PRESETS);
const targetTypeSchema = z.enum(["user", "role"]);

const setThresholdInput = z.object({
  guildId: discordIdSchema,
  violationType: violationTypeSchema,
  preset: presetSchema,
  enabled: z.boolean(),
});

const whitelistTargetInput = z.object({
  guildId: discordIdSchema,
  targetType: targetTypeSchema,
  targetId: discordIdSchema,
});

/**
 * targetがguild内に実在するかをサーバー側で検証する(dashboard-accessのcapabilityGrantsRouter
 * と同じ理由: Dashboard UIはセレクター経由のみでtargetIdを渡す設計だが、tRPC呼び出し自体は
 * その制約を経由しないため、存在しないIDが誤って保存されないようserver側でも検証する)。
 * `@everyone`(targetId===guildId)のroleは許可しない。全メンバーがroles.cacheに
 * `@everyone`を含むため、ホワイトリスト化するとモデレーション機能が実質的に全停止してしまう
 * (capabilityGrantsのcapability grantとは異なり、ホワイトリストは「判定を丸ごとスキップする」
 * 機能のため@everyoneへの適用が破壊的、codexレビュー対応)。
 */
async function assertWhitelistTargetExists(
  ctx: { verifyGuildRole: (guildId: string, roleId: string) => Promise<boolean>; isGuildMember: (guildId: string, userId: string) => Promise<boolean> },
  guildId: string,
  targetType: "user" | "role",
  targetId: string,
): Promise<void> {
  if (targetType === "role") {
    if (targetId === guildId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "@everyone cannot be whitelisted" });
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

export const moderationRouter = router({
  listThresholds: protectedProcedure
    .input(guildIdInput)
    .use(requireCapability(CAPABILITIES.MANAGE_MODERATION))
    .query(({ ctx, input }) => listThresholds(ctx.db, input.guildId)),

  setThreshold: protectedProcedure
    .input(setThresholdInput)
    .use(requireCapability(CAPABILITIES.MANAGE_MODERATION))
    .mutation(({ ctx, input }) =>
      setThreshold(ctx.db, input.guildId, input.violationType, input.preset, input.enabled),
    ),

  listWhitelist: protectedProcedure
    .input(guildIdInput)
    .use(requireCapability(CAPABILITIES.MANAGE_MODERATION))
    .query(({ ctx, input }) => listWhitelist(ctx.db, input.guildId)),

  /**
   * Dashboard UIでのID直接入力を禁止するため、選択肢(実在ロール)をこのprocedure経由で提供する。
   * getGuildRolesは403(Bot権限・Privileged Intent不足)と404(Bot未参加)を区別せず空配列に
   * 倒すため、accessStatusを併せて返しUIが「Botに権限がないため取得できません」を表示できるようにする。
   */
  listRoleOptions: protectedProcedure
    .input(guildIdInput)
    .use(requireCapability(CAPABILITIES.MANAGE_MODERATION))
    .query(async ({ ctx, input }) => {
      const [roles, accessStatus] = await Promise.all([
        ctx.getGuildRoles(input.guildId),
        ctx.getGuildAccessStatus(input.guildId),
      ]);
      return { roles, accessStatus };
    }),

  /** Dashboard UIでのID直接入力を禁止するため、選択肢(実在メンバー)をこのprocedure経由で提供する。 */
  listMemberOptions: protectedProcedure
    .input(guildIdInput.extend({ after: z.string().min(1).optional() }))
    .use(requireCapability(CAPABILITIES.MANAGE_MODERATION))
    .query(({ ctx, input }) => ctx.getGuildMembersPage(input.guildId, input.after)),

  addToWhitelist: protectedProcedure
    .input(whitelistTargetInput)
    .use(requireCapability(CAPABILITIES.MANAGE_MODERATION))
    .mutation(async ({ ctx, input }) => {
      await assertWhitelistTargetExists(ctx, input.guildId, input.targetType, input.targetId);
      await addToWhitelist(ctx.db, input);
    }),

  removeFromWhitelist: protectedProcedure
    .input(whitelistTargetInput)
    .use(requireCapability(CAPABILITIES.MANAGE_MODERATION))
    .mutation(({ ctx, input }) => removeFromWhitelist(ctx.db, input)),

  /**
   * メッセージ削除・タイムアウト・キック/BANの実行に必要な権限をBotが持っているかを返す。
   * 不足時にDashboardから案内する再認可URL(必要権限のみを含む)を併せて返す(#174 codexレビュー対応)。
   */
  getRequiredPermissionStatus: protectedProcedure
    .input(guildIdInput)
    .use(requireCapability(CAPABILITIES.MANAGE_MODERATION))
    .query(async ({ ctx, input }) => {
      const [permissions, accessStatus] = await Promise.all([
        ctx.getBotPermissions(input.guildId),
        ctx.getGuildAccessStatus(input.guildId),
      ]);
      const hasRequiredPermissions =
        (permissions & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator ||
        (permissions & MODERATION_REQUIRED_PERMISSIONS) === MODERATION_REQUIRED_PERMISSIONS;

      return {
        hasRequiredPermissions,
        reauthorizeUrl: hasRequiredPermissions
          ? null
          : buildInviteUrl(ctx.discordClientId, MODERATION_REQUIRED_PERMISSIONS, { guildId: input.guildId }),
        accessStatus,
      };
    }),
});
