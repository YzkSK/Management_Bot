import { protectedProcedure, requireCapability, router } from "@management-bot/dashboard-access";
import { CAPABILITIES, discordIdSchema } from "@management-bot/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  findTempVoiceChannel,
  getTempVoiceConfig,
  listActiveTempVoiceChannels,
  listDenyProtectedRoleIds,
  notifyTempVoiceAutoSetup,
  notifyTempVoiceForceDelete,
  replaceDenyProtectedRoles,
  upsertTempVoiceConfig,
} from "../application/index.js";
import { validateBitrateKbps, validateNameTemplate, validateUserLimit } from "../domain/index.js";

const guildIdInput = z.object({ guildId: discordIdSchema });

const setConfigInput = z.object({
  guildId: discordIdSchema,
  createChannelId: discordIdSchema.optional(),
  categoryId: discordIdSchema.optional(),
  nameTemplate: z.string().optional(),
  defaultUserLimit: z.number().optional(),
  defaultBitrate: z.number().nullable().optional(),
});

const setDenyProtectedRolesInput = z.object({
  guildId: discordIdSchema,
  roleIds: z.array(discordIdSchema),
});

const forceDeleteInput = z.object({ guildId: discordIdSchema, channelId: discordIdSchema });

export const tempVoiceRouter = router({
  getConfig: protectedProcedure
    .input(guildIdInput)
    .use(requireCapability(CAPABILITIES.VIEW_TEMP_VOICE))
    .query(({ ctx, input }) => getTempVoiceConfig(ctx.db, input.guildId)),

  /**
   * createChannelId/categoryIdはギルドの実VC一覧・実カテゴリ一覧からそれぞれ検証する
   * (種別を問わない実在確認ではなく種別ごとに検証、Dashboard UIでのID直接入力禁止の徹底)。
   */
  setConfig: protectedProcedure
    .input(setConfigInput)
    .use(requireCapability(CAPABILITIES.MANAGE_TEMP_VOICE))
    .mutation(async ({ ctx, input }) => {
      if (input.createChannelId !== undefined) {
        const voiceChannels = await ctx.getGuildVoiceChannelOptions(input.guildId);
        if (!voiceChannels.some((c) => c.id === input.createChannelId)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "createChannelId is not a voice channel of this guild" });
        }
      }
      if (input.categoryId !== undefined) {
        const categories = await ctx.getGuildCategoryOptions(input.guildId);
        if (!categories.some((c) => c.id === input.categoryId)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "categoryId is not a category of this guild" });
        }
      }
      if (input.nameTemplate !== undefined) {
        const validated = validateNameTemplate(input.nameTemplate);
        if (!validated.ok) throw new TRPCError({ code: "BAD_REQUEST", message: validated.message });
      }
      if (input.defaultUserLimit !== undefined) {
        const validated = validateUserLimit(String(input.defaultUserLimit));
        if (!validated.ok) throw new TRPCError({ code: "BAD_REQUEST", message: validated.message });
      }
      if (input.defaultBitrate !== undefined && input.defaultBitrate !== null) {
        const maxBitrateBps = Number(await ctx.getBotPermissions(input.guildId)) > 0 ? 384_000 : 96_000;
        const validated = validateBitrateKbps(String(Math.floor(input.defaultBitrate / 1000)), maxBitrateBps);
        if (!validated.ok) throw new TRPCError({ code: "BAD_REQUEST", message: validated.message });
      }

      await upsertTempVoiceConfig(ctx.db, input.guildId, {
        createChannelId: input.createChannelId,
        categoryId: input.categoryId,
        nameTemplate: input.nameTemplate,
        defaultUserLimit: input.defaultUserLimit,
        defaultBitrate: input.defaultBitrate,
      });
    }),

  /**
   * createChannelId/categoryIdが両方未設定のギルドでのみ受け付ける(二重実行防止、
   * UIの表示制御だけに頼らずprocedure自身もガードする、issue受け入れ条件)。
   */
  autoSetupConfig: protectedProcedure
    .input(guildIdInput)
    .use(requireCapability(CAPABILITIES.MANAGE_TEMP_VOICE))
    .mutation(async ({ ctx, input }) => {
      const config = await getTempVoiceConfig(ctx.db, input.guildId);
      if (config?.createChannelId || config?.categoryId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "temp voice is already configured for this guild" });
      }
      await notifyTempVoiceAutoSetup(ctx.db, input.guildId);
    }),

  getDenyProtectedRoles: protectedProcedure
    .input(guildIdInput)
    .use(requireCapability(CAPABILITIES.VIEW_TEMP_VOICE))
    .query(({ ctx, input }) => listDenyProtectedRoleIds(ctx.db, input.guildId)),

  setDenyProtectedRoles: protectedProcedure
    .input(setDenyProtectedRolesInput)
    .use(requireCapability(CAPABILITIES.MANAGE_TEMP_VOICE))
    .mutation(async ({ ctx, input }) => {
      const roles = await ctx.getGuildRoles(input.guildId);
      const validRoleIds = new Set(roles.map((r) => r.id));
      for (const roleId of input.roleIds) {
        if (!validRoleIds.has(roleId)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `roleId ${roleId} is not a role of this guild` });
        }
      }
      await replaceDenyProtectedRoles(ctx.db, input.guildId, input.roleIds);
    }),

  listActiveChannels: protectedProcedure
    .input(guildIdInput)
    .use(requireCapability(CAPABILITIES.VIEW_TEMP_VOICE))
    .query(({ ctx, input }) => listActiveTempVoiceChannels(ctx.db, input.guildId)),

  forceDelete: protectedProcedure
    .input(forceDeleteInput)
    .use(requireCapability(CAPABILITIES.MANAGE_TEMP_VOICE))
    .mutation(async ({ ctx, input }) => {
      const row = await findTempVoiceChannel(ctx.db, input.channelId);
      if (!row || row.guildId !== input.guildId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "channelId is not an active temp voice channel of this guild" });
      }
      await notifyTempVoiceForceDelete(ctx.db, input.guildId, input.channelId);
    }),

  /**
   * Dashboard UIでのID直接入力を禁止するため、選択肢(実在VC)をこのprocedure経由で提供する
   * (moderationRouter.listRoleOptionsと同じ設計、issue #415)。
   */
  listVoiceChannelOptions: protectedProcedure
    .input(guildIdInput)
    .use(requireCapability(CAPABILITIES.MANAGE_TEMP_VOICE))
    .query(({ ctx, input }) => ctx.getGuildVoiceChannelOptions(input.guildId)),

  /** Dashboard UIでのID直接入力を禁止するため、選択肢(実在カテゴリ)をこのprocedure経由で提供する。 */
  listCategoryOptions: protectedProcedure
    .input(guildIdInput)
    .use(requireCapability(CAPABILITIES.MANAGE_TEMP_VOICE))
    .query(({ ctx, input }) => ctx.getGuildCategoryOptions(input.guildId)),

  /** 拒否禁止ロールタブのロール選択肢。MANAGE_MODERATION権限を要求するmoderationRouter.listRoleOptionsとは
   * 別に、MANAGE_TEMP_VOICE権限者が呼べるようここに用意する。 */
  listRoleOptions: protectedProcedure
    .input(guildIdInput)
    .use(requireCapability(CAPABILITIES.MANAGE_TEMP_VOICE))
    .query(({ ctx, input }) => ctx.getGuildRoles(input.guildId)),
});
