import {
  captureAuditBefore,
  protectedProcedure,
  requireCapability,
  requireGuildMember,
  router,
} from "@management-bot/dashboard-access";
import { CAPABILITIES, buildInviteUrl, discordIdSchema, roleMentionLabel } from "@management-bot/shared";
import { TRPCError } from "@trpc/server";
import { PermissionFlagsBits } from "discord.js";
import { z } from "zod";
import {
  cancelScheduledPost,
  getScheduledPost,
  getSettings,
  listGuildPosts,
  notifyScheduledPostAdminCancel,
  saveSettings,
} from "../application/index.js";
import { SCHEDULED_POST_REQUIRED_PERMISSIONS } from "../discord/required-permissions.js";

const guildIdInput = z.object({ guildId: discordIdSchema });
const MAX_MENTION_NAME_LOOKUPS = 100;
const cancelInput = z.object({ guildId: discordIdSchema, id: z.uuid() });
const updateSettingsInput = z.object({
  guildId: discordIdSchema,
  roleIds: z.array(discordIdSchema).max(250),
  allowEveryone: z.boolean(),
  allowHere: z.boolean(),
});

// requireCapabilityは検証済みinputのguildIdを読むため、`.input()`の後に`.use()`する(temp-voiceと同じ)。
const viewProcedure = <TInput extends z.ZodType<{ guildId: string }>>(input: TInput) =>
  protectedProcedure.input(input).use(requireCapability(CAPABILITIES.VIEW_SCHEDULED_POSTS));
const manageProcedure = <TInput extends z.ZodType<{ guildId: string }>>(input: TInput) =>
  protectedProcedure.input(input).use(requireCapability(CAPABILITIES.MANAGE_SCHEDULED_POSTS));

export const scheduledPostRouter = router({
  /**
   * ギルド全体の予約(保持期間内の全状態)。閲覧権限がないメンバーは自分の予約のみ(DBクエリで絞る)。
   * ユーザー・チャンネルは名前を解決して返す(解決できなければ未設定)。
   */
  list: protectedProcedure
    .input(guildIdInput)
    .use(requireGuildMember())
    .query(async ({ ctx, input }) => {
    const canViewAll = (ctx.capabilities & CAPABILITIES.VIEW_SCHEDULED_POSTS) === CAPABILITIES.VIEW_SCHEDULED_POSTS;
    const rows = await listGuildPosts(ctx.db, input.guildId, canViewAll ? undefined : { authorId: ctx.discordUserId });
    if (rows.length === 0) return [];
    // メンション先ユーザーの名前解決は表示の補助なので件数を絞る(超えた分はIDのまま表示)。
    const mentionUserIds = [...new Set(rows.flatMap((row) => row.mentionUserIds))].slice(0, MAX_MENTION_NAME_LOOKUPS);
    const userIds = new Set([...rows.map((row) => row.authorId), ...mentionUserIds]);
    const hasRoleMentions = rows.some((row) => row.mentionRoleIds.length > 0);
    const [channels, userNames, roles, memberPage] = await Promise.all([
      ctx.getAllGuildChannels(input.guildId),
      ctx.getGuildMemberNames(input.guildId, [...userIds]),
      // ロール名の取得失敗で一覧全体を失敗させない(IDのまま表示する)。
      hasRoleMentions ? ctx.getGuildRoles(input.guildId).catch(() => []) : Promise.resolve([]),
      // 予約者アイコン用。名前解決と同じキャッシュ済みのメンバー一覧から取るだけ(失敗時は頭文字アイコン)。
      ctx.getGuildMembersPage(input.guildId).catch(() => ({ members: [] })),
    ]);
    const avatarUrls = new Map(memberPage.members.flatMap((m) => (m.avatarUrl ? [[m.id, m.avatarUrl] as const] : [])));
    const channelNames = new Map(channels.map((channel) => [channel.id, channel.name]));
    const roleNames = new Map(roles.map((role) => [role.id, role.name]));
    return rows.map((row) => ({
      id: row.id,
      channelId: row.channelId,
      channelName: channelNames.get(row.channelId),
      authorId: row.authorId,
      isMine: row.authorId === ctx.discordUserId,
      authorName: userNames.get(row.authorId),
      authorAvatarUrl: avatarUrls.get(row.authorId),
      content: row.content,
      scheduledAt: row.scheduledAt,
      status: row.status,
      failureReason: row.failureReason,
      cancelledBy: row.cancelledBy,
      finishedAt: row.finishedAt,
      /** メンション先の表示名(@everyone/@here/@ロール名/@ユーザー名)。名前を解決できなければID。 */
      mentions: [
        ...(row.mentionEveryone ? ["@everyone"] : []),
        ...(row.mentionHere ? ["@here"] : []),
        ...row.mentionRoleIds.map((id) => roleMentionLabel(roleNames.get(id) ?? id)),
        ...row.mentionUserIds.map((id) => `@${userNames.get(id) ?? id}`),
      ],
    }));
  }),

  /**
   * 管理者による取り消し。投稿待ち(pending)の間のみ条件付き更新で成功する。成功後、予約者へのDMと
   * ログイベント発行をBotにpg_notifyで依頼する(取り消し自体はここでDB上完了している)。
   */
  cancel: manageProcedure(cancelInput).mutation(async ({ ctx, input }) => {
    const row = await cancelScheduledPost(ctx.db, {
      id: input.id,
      by: "admin",
      guildId: input.guildId,
      executor: { id: ctx.discordUserId, name: ctx.discordUsername },
      now: new Date(),
    });
    if (!row) {
      throw new TRPCError({ code: "CONFLICT", message: "この予約はすでに投稿処理が始まったか、取り消されています。" });
    }
    await notifyScheduledPostAdminCancel(ctx.db, { guildId: input.guildId, postId: row.id });
  }),

  /**
   * 本人による取り消し(/scheduleの本人取り消しと同じ扱い)。管理権限は不要で、在籍と本人確認のみ。
   * 操作履歴(audit_logs)には記録しない(#618)。予約者へのDMは送らず、ログイベントのみBotに依頼する。
   */
  cancelOwn: protectedProcedure
    .input(cancelInput)
    .use(requireGuildMember())
    .mutation(async ({ ctx, input }) => {
      const post = await getScheduledPost(ctx.db, input.id);
      if (!post || post.guildId !== input.guildId || post.authorId !== ctx.discordUserId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const row = await cancelScheduledPost(ctx.db, {
        id: input.id,
        by: "author",
        guildId: input.guildId,
        authorId: ctx.discordUserId,
        now: new Date(),
      });
      if (!row) {
        throw new TRPCError({ code: "CONFLICT", message: "この予約はすでに投稿処理が始まったか、取り消されています。" });
      }
      // 取り消しは確定済み。通知に失敗してもBotのtick回収がログイベントを発行するため、失敗扱いにしない。
      await notifyScheduledPostAdminCancel(ctx.db, { guildId: input.guildId, postId: row.id, by: "author" }).catch(
        (error: unknown) => console.error("Failed to notify scheduled post self-cancel:", error),
      );
    }),

  getSettings: manageProcedure(guildIdInput).query(async ({ ctx, input }) => {
    const { allowedRoleIds, allowEveryone, allowHere } = await getSettings(ctx.db, input.guildId);
    return { allowedRoleIds, allowEveryone, allowHere };
  }),

  /** 設定を置き換える。roleIds空配列=メンバー全員が使える。ロールは実在するもののみ(@everyone除く)。 */
  updateSettings: manageProcedure(updateSettingsInput).mutation(async ({ ctx, input }) => {
    const roles = await ctx.getGuildRoles(input.guildId);
    const validRoleIds = new Set(roles.filter((role) => role.id !== input.guildId).map((role) => role.id));
    for (const roleId of input.roleIds) {
      if (!validRoleIds.has(roleId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `roleId ${roleId} is not a role of this guild` });
      }
    }
    await captureAuditBefore(ctx, () => getSettings(ctx.db, input.guildId));
    await saveSettings(ctx.db, input.guildId, {
      allowedRoleIds: input.roleIds,
      allowEveryone: input.allowEveryone,
      allowHere: input.allowHere,
    });
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
