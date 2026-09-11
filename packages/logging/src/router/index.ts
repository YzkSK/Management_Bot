import { protectedProcedure, requireCapability, router } from "@management-bot/dashboard-access";
import { buildInviteUrl, CAPABILITIES, discordIdSchema, LOG_CATEGORIES, hasCapability } from "@management-bot/shared";
import { TRPCError } from "@trpc/server";
import { PermissionFlagsBits } from "discord.js";
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
import { LOGGING_REQUIRED_PERMISSIONS } from "../discord/required-permissions.js";

const listLogEntriesInput = z.object({
  guildId: discordIdSchema,
  category: z.enum(LOG_CATEGORIES).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  /** 前回レスポンスのnextCursorをそのまま渡す不透明なトークン。 */
  cursor: z.string().min(1).optional(),
});

const guildIdInput = z.object({
  guildId: discordIdSchema,
});

/** 100年。無期限保存(0)以外の実運用上限として設定し、DBのinteger範囲外の値を弾く。 */
const MAX_RETENTION_DAYS = 36_500;

const setRetentionSettingInput = z.object({
  guildId: discordIdSchema,
  category: z.enum(LOG_CATEGORIES),
  retentionDays: z.number().int().min(0).max(MAX_RETENTION_DAYS),
});

const setRetentionSettingForAllCategoriesInput = z.object({
  guildId: discordIdSchema,
  retentionDays: z.number().int().min(0).max(MAX_RETENTION_DAYS),
});

const setChannelSettingInput = z.object({
  guildId: discordIdSchema,
  category: z.enum(LOG_CATEGORIES),
  /** nullで出力先未設定に戻す(該当カテゴリの送信を停止)。 */
  channelId: discordIdSchema.nullable(),
});

const setChannelSettingForAllCategoriesInput = z.object({
  guildId: discordIdSchema,
  channelId: discordIdSchema.nullable(),
});

/** 呼び出し側が変更したいフィールドのみ送る(部分更新)。未指定フィールドは既存値を維持する。 */
const setDisplaySettingInput = z
  .object({
    guildId: discordIdSchema,
    hideAuditLogCorrelation: z.boolean().optional(),
    hideBotEvents: z.boolean().optional(),
  })
  .refine(
    ({ hideAuditLogCorrelation, hideBotEvents }) =>
      hideAuditLogCorrelation !== undefined || hideBotEvents !== undefined,
    { message: "at least one of hideAuditLogCorrelation/hideBotEvents is required" },
  );

const resolveDisplayNamesInput = z.object({
  guildId: discordIdSchema,
  userIds: z.array(z.string()).default([]),
  channelIds: z.array(z.string()).default([]),
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
      const excludeBotEvents = displaySettings.hideBotEvents;

      let result;
      try {
        result = await listLogEntries(ctx.db, { ...input, excludeCategories, excludeBotEvents });
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "invalid cursor" });
      }
      const hasRawAccess = hasCapability(ctx.capabilities, CAPABILITIES.VIEW_LOGS_RAW);

      return {
        hasRawAccess,
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

  /**
   * Dashboard UIでのID直接入力を禁止するため、選択肢(実在チャンネル)をこのprocedure経由で提供する。
   * getGuildChannelsは403(Bot権限・Privileged Intent不足)と404(Bot未参加)を区別せず空配列に
   * 倒すため、accessStatusを併せて返しUIが「Botに権限がないため取得できません」を表示できるようにする
   * (issue #214)。
   */
  listChannelOptions: protectedProcedure
    .input(guildIdInput)
    .use(requireCapability(CAPABILITIES.MANAGE_LOGGING_SETTINGS))
    .query(async ({ ctx, input }) => {
      const [channels, accessStatus] = await Promise.all([
        ctx.getGuildChannels(input.guildId),
        ctx.getGuildAccessStatus(input.guildId),
      ]);
      return { channels, accessStatus };
    }),

  setChannelSetting: protectedProcedure
    .input(setChannelSettingInput)
    .use(requireCapability(CAPABILITIES.MANAGE_LOGGING_SETTINGS))
    .mutation(async ({ ctx, input }) => {
      if (input.channelId !== null) {
        const exists = await ctx.verifyGuildChannel(input.guildId, input.channelId);
        if (!exists) {
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
        const exists = await ctx.verifyGuildChannel(input.guildId, input.channelId);
        if (!exists) {
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
    .mutation(({ ctx, input }) => {
      const { guildId, ...patch } = input;
      return setDisplaySetting(ctx.db, guildId, patch);
    }),

  /**
   * ログ一覧でユーザーID/チャンネルIDをそのまま見せず名前表示するため、まとめて解決する。
   * 解決できなかったIDはレスポンスに含めない(呼び出し側でIDへフォールバック表示する)。
   */
  resolveDisplayNames: protectedProcedure
    .input(resolveDisplayNamesInput)
    .use(requireCapability(CAPABILITIES.VIEW_LOGS))
    .query(async ({ ctx, input }) => {
      const uniqueUserIds = [...new Set(input.userIds)];
      const [userNames, channels] = await Promise.all([
        uniqueUserIds.length > 0
          ? ctx.getGuildMemberNames(input.guildId, uniqueUserIds)
          : Promise.resolve(new Map<string, string>()),
        ctx.getAllGuildChannels(input.guildId),
      ]);
      const channelNameById = new Map(channels.map((c) => [c.id, c.name]));
      const wantedChannelIds = new Set(input.channelIds);

      return {
        users: Object.fromEntries(userNames),
        channels: Object.fromEntries(
          [...channelNameById].filter(([id]) => wantedChannelIds.has(id)),
        ),
      };
    }),

  /**
   * integration/auditLogCorrelation(実行者事後補完・kick判定等)はguildAuditLogEntryCreate
   * イベントに依存するが、Botに「監査ログを見る」権限(ViewAuditLog)がないと配信されない(issue #80)。
   * 権限保有状況と、不足時にDashboardから案内する再認可URL(必要権限のみを含む)を返す。
   */
  getAuditLogPermissionStatus: protectedProcedure
    .input(guildIdInput)
    .use(requireCapability(CAPABILITIES.MANAGE_LOGGING_SETTINGS))
    .query(async ({ ctx, input }) => {
      const [permissions, accessStatus] = await Promise.all([
        ctx.getBotPermissions(input.guildId),
        ctx.getGuildAccessStatus(input.guildId),
      ]);
      const hasViewAuditLog =
        (permissions & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator ||
        (permissions & LOGGING_REQUIRED_PERMISSIONS) === LOGGING_REQUIRED_PERMISSIONS;

      return {
        hasViewAuditLog,
        reauthorizeUrl: hasViewAuditLog
          ? null
          : buildInviteUrl(ctx.discordClientId, LOGGING_REQUIRED_PERMISSIONS, { guildId: input.guildId }),
        /**
         * hasViewAuditLog=falseの理由がBot権限不足(forbidden)なのかBot未参加(not_found)なのかを
         * UIへ伝える(issue #214)。fetchBotGuildPermissionsは403/404を区別せず0nに倒すため、
         * 従来はUIから権限不足を判別できなかった。
         */
        accessStatus,
      };
    }),
});
