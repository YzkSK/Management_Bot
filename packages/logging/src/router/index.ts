import { protectedProcedure, requireCapability, router } from "@management-bot/dashboard-access";
import { CAPABILITIES, LOG_CATEGORIES, hasCapability } from "@management-bot/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  getDisplaySettings,
  listChannelSettings,
  listLogEntries,
  listRetentionSettings,
  maskSensitiveFields,
  setChannelSetting,
  setChannelSettingForAllCategories,
  setDisplaySetting,
  setRetentionSetting,
  setRetentionSettingForAllCategories,
} from "../application/index.js";

const listLogEntriesInput = z.object({
  guildId: z.string().min(1),
  category: z.enum(LOG_CATEGORIES).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  /** 前回レスポンスのnextCursorをそのまま渡す不透明なトークン。 */
  cursor: z.string().min(1).optional(),
});

const guildIdInput = z.object({
  guildId: z.string().min(1),
});

/** 100年。無期限保存(0)以外の実運用上限として設定し、DBのinteger範囲外の値を弾く。 */
const MAX_RETENTION_DAYS = 36_500;

const setRetentionSettingInput = z.object({
  guildId: z.string().min(1),
  category: z.enum(LOG_CATEGORIES),
  retentionDays: z.number().int().min(0).max(MAX_RETENTION_DAYS),
});

const setRetentionSettingForAllCategoriesInput = z.object({
  guildId: z.string().min(1),
  retentionDays: z.number().int().min(0).max(MAX_RETENTION_DAYS),
});

const setChannelSettingInput = z.object({
  guildId: z.string().min(1),
  category: z.enum(LOG_CATEGORIES),
  /** nullで出力先未設定に戻す(該当カテゴリの送信を停止)。 */
  channelId: z.string().min(1).nullable(),
});

const setChannelSettingForAllCategoriesInput = z.object({
  guildId: z.string().min(1),
  channelId: z.string().min(1).nullable(),
});

const setDisplaySettingInput = z.object({
  guildId: z.string().min(1),
  hideAuditLogCorrelation: z.boolean(),
});

export const loggingRouter = router({
  listLogEntries: protectedProcedure
    .input(listLogEntriesInput)
    .use(requireCapability(CAPABILITIES.VIEW_LOGS))
    .query(async ({ ctx, input }) => {
      const displaySettings = await getDisplaySettings(ctx.db, input.guildId);
      const excludeCategories =
        displaySettings.hideAuditLogCorrelation && input.category !== "auditLogCorrelation"
          ? (["auditLogCorrelation"] as const)
          : undefined;

      let result;
      try {
        result = await listLogEntries(ctx.db, { ...input, excludeCategories });
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "invalid cursor" });
      }
      const hasRawAccess = hasCapability(ctx.capabilities, CAPABILITIES.VIEW_LOGS_RAW);

      return {
        entries: result.entries.map(({ id, entry }) => ({
          id,
          entry: hasRawAccess ? entry : maskSensitiveFields(entry),
        })),
        nextCursor: result.nextCursor,
      };
    }),

  listRetentionSettings: protectedProcedure
    .input(guildIdInput)
    .use(requireCapability(CAPABILITIES.MANAGE_LOGGING_SETTINGS))
    .query(({ ctx, input }) => listRetentionSettings(ctx.db, input.guildId)),

  setRetentionSetting: protectedProcedure
    .input(setRetentionSettingInput)
    .use(requireCapability(CAPABILITIES.MANAGE_LOGGING_SETTINGS))
    .mutation(({ ctx, input }) =>
      setRetentionSetting(ctx.db, input.guildId, input.category, input.retentionDays),
    ),

  listChannelSettings: protectedProcedure
    .input(guildIdInput)
    .use(requireCapability(CAPABILITIES.MANAGE_LOGGING_SETTINGS))
    .query(({ ctx, input }) => listChannelSettings(ctx.db, input.guildId)),

  /** Dashboard UIでのID直接入力を禁止するため、選択肢(実在チャンネル)をこのprocedure経由で提供する。 */
  listChannelOptions: protectedProcedure
    .input(guildIdInput)
    .use(requireCapability(CAPABILITIES.MANAGE_LOGGING_SETTINGS))
    .query(({ ctx, input }) => ctx.getGuildChannels(input.guildId)),

  setChannelSetting: protectedProcedure
    .input(setChannelSettingInput)
    .use(requireCapability(CAPABILITIES.MANAGE_LOGGING_SETTINGS))
    .mutation(async ({ ctx, input }) => {
      if (input.channelId !== null) {
        const options = await ctx.getGuildChannels(input.guildId);
        if (!options.some((option) => option.id === input.channelId)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "channelId is not a channel of this guild" });
        }
      }
      await setChannelSetting(ctx.db, input.guildId, input.category, input.channelId);
    }),

  setRetentionSettingForAllCategories: protectedProcedure
    .input(setRetentionSettingForAllCategoriesInput)
    .use(requireCapability(CAPABILITIES.MANAGE_LOGGING_SETTINGS))
    .mutation(({ ctx, input }) => setRetentionSettingForAllCategories(ctx.db, input.guildId, input.retentionDays)),

  setChannelSettingForAllCategories: protectedProcedure
    .input(setChannelSettingForAllCategoriesInput)
    .use(requireCapability(CAPABILITIES.MANAGE_LOGGING_SETTINGS))
    .mutation(async ({ ctx, input }) => {
      if (input.channelId !== null) {
        const options = await ctx.getGuildChannels(input.guildId);
        if (!options.some((option) => option.id === input.channelId)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "channelId is not a channel of this guild" });
        }
      }
      await setChannelSettingForAllCategories(ctx.db, input.guildId, input.channelId);
    }),

  getDisplaySettings: protectedProcedure
    .input(guildIdInput)
    .use(requireCapability(CAPABILITIES.MANAGE_LOGGING_SETTINGS))
    .query(({ ctx, input }) => getDisplaySettings(ctx.db, input.guildId)),

  setDisplaySetting: protectedProcedure
    .input(setDisplaySettingInput)
    .use(requireCapability(CAPABILITIES.MANAGE_LOGGING_SETTINGS))
    .mutation(({ ctx, input }) => setDisplaySetting(ctx.db, input.guildId, input.hideAuditLogCorrelation)),
});
