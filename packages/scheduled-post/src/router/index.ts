import { protectedProcedure, requireCapability, router } from "@management-bot/dashboard-access";
import { CAPABILITIES, buildInviteUrl, discordIdSchema } from "@management-bot/shared";
import { TRPCError } from "@trpc/server";
import { PermissionFlagsBits } from "discord.js";
import { z } from "zod";
import {
  cancelScheduledPost,
  getAllowedRoleIds,
  listGuildPosts,
  notifyScheduledPostAdminCancel,
  setAllowedRoleIds,
} from "../application/index.js";
import { SCHEDULED_POST_REQUIRED_PERMISSIONS } from "../discord/required-permissions.js";

const guildIdInput = z.object({ guildId: discordIdSchema });
const cancelInput = z.object({ guildId: discordIdSchema, id: z.uuid() });
const updateSettingsInput = z.object({ guildId: discordIdSchema, roleIds: z.array(discordIdSchema).max(250) });

// requireCapabilityは検証済みinputのguildIdを読むため、`.input()`の後に`.use()`する(temp-voiceと同じ)。
const viewProcedure = <TInput extends z.ZodType<{ guildId: string }>>(input: TInput) =>
  protectedProcedure.input(input).use(requireCapability(CAPABILITIES.VIEW_SCHEDULED_POSTS));
const manageProcedure = <TInput extends z.ZodType<{ guildId: string }>>(input: TInput) =>
  protectedProcedure.input(input).use(requireCapability(CAPABILITIES.MANAGE_SCHEDULED_POSTS));

export const scheduledPostRouter = router({
  /** ギルド全体の予約(保持期間内の全状態)。ユーザー・チャンネルは名前を解決して返す(解決できなければ未設定)。 */
  list: viewProcedure(guildIdInput).query(async ({ ctx, input }) => {
    const rows = await listGuildPosts(ctx.db, input.guildId);
    if (rows.length === 0) return [];
    const [channels, authorNames] = await Promise.all([
      ctx.getAllGuildChannels(input.guildId),
      ctx.getGuildMemberNames(input.guildId, [...new Set(rows.map((row) => row.authorId))]),
    ]);
    const channelNames = new Map(channels.map((channel) => [channel.id, channel.name]));
    return rows.map((row) => ({
      id: row.id,
      channelId: row.channelId,
      channelName: channelNames.get(row.channelId),
      authorId: row.authorId,
      authorName: authorNames.get(row.authorId),
      content: row.content,
      scheduledAt: row.scheduledAt,
      status: row.status,
      failureReason: row.failureReason,
      cancelledBy: row.cancelledBy,
      finishedAt: row.finishedAt,
    }));
  }),

  /**
   * 管理者による取り消し。投稿待ち(pending)の間のみ条件付き更新で成功する。成功後、予約者へのDMと
   * ログイベント発行をBotにpg_notifyで依頼する(取り消し自体はここでDB上完了している)。
   */
  cancel: manageProcedure(cancelInput).mutation(async ({ ctx, input }) => {
    const row = await cancelScheduledPost(ctx.db, { id: input.id, by: "admin", guildId: input.guildId, now: new Date() });
    if (!row) {
      throw new TRPCError({ code: "CONFLICT", message: "この予約はすでに投稿処理が始まったか、取り消されています。" });
    }
    await notifyScheduledPostAdminCancel(ctx.db, {
      guildId: input.guildId,
      postId: row.id,
      executorId: ctx.discordUserId,
      executorName: ctx.discordUsername,
    });
  }),

  getSettings: manageProcedure(guildIdInput).query(async ({ ctx, input }) => ({
    allowedRoleIds: await getAllowedRoleIds(ctx.db, input.guildId),
  })),

  /** 「使えるロール」を置き換える。空配列=メンバー全員が使える。ロールは実在するもののみ(@everyone除く)。 */
  updateSettings: manageProcedure(updateSettingsInput).mutation(async ({ ctx, input }) => {
    const roles = await ctx.getGuildRoles(input.guildId);
    const validRoleIds = new Set(roles.filter((role) => role.id !== input.guildId).map((role) => role.id));
    for (const roleId of input.roleIds) {
      if (!validRoleIds.has(roleId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `roleId ${roleId} is not a role of this guild` });
      }
    }
    await setAllowedRoleIds(ctx.db, input.guildId, input.roleIds);
  }),

  /** Dashboard UIでのID直接入力を禁止するため、選択肢(実在ロール、@everyone除く)をこのprocedure経由で提供する。 */
  listRoleOptions: manageProcedure(guildIdInput).query(async ({ ctx, input }) => {
    const roles = await ctx.getGuildRoles(input.guildId);
    return roles.filter((role) => role.id !== input.guildId);
  }),

  /**
   * Botが予約投稿に必要な権限(投稿先の閲覧・送信)を持っているか。
   * 不足時は必要権限のみを含む再認可URLを返す(最小権限方針)。
   */
  getRequiredPermissionStatus: viewProcedure(guildIdInput).query(async ({ ctx, input }) => {
    const [permissions, accessStatus] = await Promise.all([
      ctx.getBotPermissions(input.guildId),
      ctx.getGuildAccessStatus(input.guildId),
    ]);
    const hasRequiredPermissions =
      (permissions & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator ||
      (permissions & SCHEDULED_POST_REQUIRED_PERMISSIONS) === SCHEDULED_POST_REQUIRED_PERMISSIONS;
    return {
      hasRequiredPermissions,
      reauthorizeUrl: hasRequiredPermissions
        ? null
        : buildInviteUrl(ctx.discordClientId, SCHEDULED_POST_REQUIRED_PERMISSIONS, { guildId: input.guildId }),
      accessStatus,
    };
  }),
});
