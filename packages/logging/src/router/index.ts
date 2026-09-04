import { protectedProcedure, requireCapability, router } from "@management-bot/dashboard-access";
import { CAPABILITIES, LOG_CATEGORIES, hasCapability } from "@management-bot/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  listChannelSettings,
  listLogEntries,
  listRetentionSettings,
  maskSensitiveFields,
  setChannelSetting,
  setRetentionSetting,
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

const setRetentionSettingInput = z.object({
  guildId: z.string().min(1),
  category: z.enum(LOG_CATEGORIES),
  retentionDays: z.number().int().min(0),
});

const setChannelSettingInput = z.object({
  guildId: z.string().min(1),
  category: z.enum(LOG_CATEGORIES),
  /** nullで出力先未設定に戻す(該当カテゴリの送信を停止)。 */
  channelId: z.string().min(1).nullable(),
});

export const loggingRouter = router({
  listLogEntries: protectedProcedure
    .input(listLogEntriesInput)
    .use(requireCapability(CAPABILITIES.VIEW_LOGS))
    .query(async ({ ctx, input }) => {
      let result;
      try {
        result = await listLogEntries(ctx.db, input);
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
});
