import { captureAuditBefore, protectedProcedure, requireCapability, requireGuildMember, router } from "@management-bot/dashboard-access";
import { CAPABILITIES, discordIdSchema, hasCapability } from "@management-bot/shared";
import { type Db, tempVoiceChannelActionSchema } from "@management-bot/db";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  clearTempVoiceCreateChannel,
  findOwnedTempVoiceChannelId,
  findTempVoiceChannel,
  getTempVoiceConfig,
  isDenyProtectedRole,
  listActiveTempVoiceChannels,
  listDenyProtectedRoleIds,
  listPermissionOverrides,
  notifyTempVoiceAutoSetup,
  notifyTempVoiceChannelAction,
  notifyTempVoiceForceDelete,
  readTempVoiceStates,
  replaceDenyProtectedRoles,
  upsertTempVoiceConfig,
  waitForTempVoiceActionResult,
} from "../application/index.js";
import {
  type TempVoiceActionFailureReason,
  type TempVoiceMemberState,
  validateBitrateKbps,
  validateChannelName,
  validateNameTemplate,
  validateUserLimit,
} from "../domain/index.js";

/** Dashboard一覧の1件。DB行にRedis上の現在状態(人数制限・音質・ロック/非表示・在室メンバー)を突き合わせたもの。 */
export interface ActiveTempVoiceChannel {
  channelId: string;
  guildId: string;
  ownerId: string;
  createdAt: Date;
  channelName: string | undefined;
  ownerName: string | undefined;
  userLimit: number | null;
  bitrate: number | null;
  isLocked: boolean;
  isHidden: boolean;
  members: TempVoiceMemberState[];
  /** 呼び出したユーザー自身がオーナーのVCか(「あなたのVC」表示・設定変更の可否)。 */
  isMine: boolean;
}

/** getChannelOverridesの1件。dashboard-apiの型生成でapplication層の型名を参照させないよう明示的に定義する。 */
export interface ChannelOverride {
  targetType: "user" | "role";
  targetId: string;
  state: "allow" | "deny";
  name: string | undefined;
}

/** updateChannelがbotの反映結果を待つ設定。テストで短い間隔・固定のrequestIdに差し替える。 */
export const updateChannelWait = {
  intervalMs: 250,
  timeoutMs: 10_000,
  newRequestId: (): string => randomUUID(),
};

const ACTION_FAILURE_MESSAGES: Record<TempVoiceActionFailureReason, string> = {
  rate_limited: "名前の変更は10分に2回までです。しばらくしてからお試しください。",
  protected_role: "このロールは拒否指定できません(サーバー管理者が保護しています)。",
  invalid_new_owner: "移譲先のメンバーがVCにいません。",
  already_owner: "選択されたメンバーは既に別の一時VCのオーナーです。",
  channel_not_found: "この一時VCは既に存在しません。",
  invalid_input: "入力値が不正です。",
  transfer_failed: "オーナー移譲に失敗しました。時間を置いて再度お試しください。",
  discord_error: "Discordへの反映に失敗しました。Botの権限を確認してください。",
};

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
const channelInput = forceDeleteInput;
const updateChannelInput = channelInput.extend({ action: tempVoiceChannelActionSchema });
const overrideTargetOptionsInput = channelInput.extend({ after: discordIdSchema.optional() });

/**
 * そのVCのオーナー本人のみが編集できる(#649)。MANAGE_TEMP_VOICE保持者・サーバーオーナーでも不可
 * (Discordの制御パネルと同じくオーナー専用)。
 * requireCapabilityを通らないため操作履歴には記録されない(Discordボタン操作と同じ扱い)。
 */
async function requireEditableChannel(
  ctx: { db: Db; discordUserId: string },
  guildId: string,
  channelId: string,
) {
  const row = await findTempVoiceChannel(ctx.db, channelId);
  if (!row || row.guildId !== guildId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "channelId is not an active temp voice channel of this guild" });
  }
  if (row.ownerId !== ctx.discordUserId) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return row;
}

// requireCapabilityは検証済みinputのguildIdを読むため、`.input()`の後に`.use()`する必要がある
// (tRPCでは`.input()`より前のmiddlewareにinputが渡らない)。そのためinputを受け取る関数の形にしている。
const tempVoiceManageProcedure = <TInput extends z.ZodType<{ guildId: string }>>(input: TInput) =>
  protectedProcedure.input(input).use(requireCapability(CAPABILITIES.MANAGE_TEMP_VOICE));

export const tempVoiceRouter = router({
  getConfig: tempVoiceManageProcedure(guildIdInput)
    .query(({ ctx, input }) => getTempVoiceConfig(ctx.db, input.guildId)),

  /**
   * createChannelId/categoryIdはギルドの実VC一覧・実カテゴリ一覧からそれぞれ検証する
   * (種別を問わない実在確認ではなく種別ごとに検証、Dashboard UIでのID直接入力禁止の徹底)。
   */
  setConfig: tempVoiceManageProcedure(setConfigInput)
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

      await captureAuditBefore(ctx, () => getTempVoiceConfig(ctx.db, input.guildId));
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
  autoSetupConfig: tempVoiceManageProcedure(guildIdInput)
    .mutation(async ({ ctx, input }) => {
      const config = await getTempVoiceConfig(ctx.db, input.guildId);
      if (config?.createChannelId || config?.categoryId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "temp voice is already configured for this guild" });
      }
      await notifyTempVoiceAutoSetup(ctx.db, input.guildId);
    }),

  /**
   * 手動設定を解除し、作成用VC/カテゴリを未設定に戻す(#412のclearTempVoiceCreateChannelを再利用)。
   * 解除後はDashboard上で自動セットアップ画面が再表示される。名前テンプレート等の共通設定は保持する。
   */
  clearConfig: tempVoiceManageProcedure(guildIdInput)
    .mutation(async ({ ctx, input }) => {
      await captureAuditBefore(ctx, () => getTempVoiceConfig(ctx.db, input.guildId));
      return clearTempVoiceCreateChannel(ctx.db, input.guildId);
    }),

  getDenyProtectedRoles: tempVoiceManageProcedure(guildIdInput)
    .query(({ ctx, input }) => listDenyProtectedRoleIds(ctx.db, input.guildId)),

  setDenyProtectedRoles: tempVoiceManageProcedure(setDenyProtectedRolesInput)
    .mutation(async ({ ctx, input }) => {
      const roles = await ctx.getGuildRoles(input.guildId);
      const validRoleIds = new Set(roles.map((r) => r.id));
      for (const roleId of input.roleIds) {
        if (!validRoleIds.has(roleId)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `roleId ${roleId} is not a role of this guild` });
        }
      }
      await captureAuditBefore(ctx, () => listDenyProtectedRoleIds(ctx.db, input.guildId));
      await replaceDenyProtectedRoles(ctx.db, input.guildId, input.roleIds);
    }),

  /** VIEW_TEMP_VOICEが無いメンバーには、自分がオーナーのVCだけを返す(予約投稿のlistと同じ設計)。 */
  listActiveChannels: protectedProcedure
    .input(guildIdInput)
    .use(requireGuildMember())
    .query(async ({ ctx, input }) => {
      const canViewAll = hasCapability(ctx.capabilities, CAPABILITIES.VIEW_TEMP_VOICE);
      const rows = (await listActiveTempVoiceChannels(ctx.db, input.guildId)).filter(
        (row) => canViewAll || row.ownerId === ctx.discordUserId,
      );
      if (rows.length === 0) return [];
      // 一覧でIDをそのまま見せないよう名前を付ける。解決できなければ未設定(画面側でIDにフォールバック)。
      const [channels, ownerNames, states] = await Promise.all([
        ctx.getAllGuildChannels(input.guildId),
        ctx.getGuildMemberNames(input.guildId, [...new Set(rows.map((row) => row.ownerId))]),
        readTempVoiceStates(ctx.readRedisHash, input.guildId),
      ]);
      const channelNames = new Map(channels.map((channel) => [channel.id, channel.name]));
      return rows.map((row): ActiveTempVoiceChannel => {
        const state = states.get(row.channelId);
        return {
          channelId: row.channelId,
          guildId: row.guildId,
          ownerId: row.ownerId,
          createdAt: row.createdAt,
          channelName: channelNames.get(row.channelId),
          ownerName: ownerNames.get(row.ownerId),
          // 状態未同期(bot停止中・作成直後など)のチャンネルは設定値null・在室者なしで返す。
          userLimit: state?.userLimit ?? null,
          bitrate: state?.bitrate ?? null,
          isLocked: state?.isLocked ?? false,
          isHidden: state?.isHidden ?? false,
          members: state?.members ?? [],
          isMine: row.ownerId === ctx.discordUserId,
        };
      });
    }),

  /** オーナー(またはMANAGE_TEMP_VOICE保持者)がDashboardから一時VCの設定を変更する。実反映はbotがpg_notify経由で行う。 */
  updateChannel: protectedProcedure
    .input(updateChannelInput)
    .use(requireGuildMember())
    .mutation(async ({ ctx, input }) => {
      const row = await requireEditableChannel(ctx, input.guildId, input.channelId);
      const { action } = input;
      const badRequest = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });

      switch (action.type) {
        case "rename": {
          const validated = validateChannelName(action.name);
          if (!validated.ok) throw badRequest(validated.message);
          break;
        }
        case "userLimit": {
          const validated = validateUserLimit(String(action.value));
          if (!validated.ok) throw badRequest(validated.message);
          break;
        }
        case "bitrate": {
          const maxBitrateBps = Number(await ctx.getBotPermissions(input.guildId)) > 0 ? 384_000 : 96_000;
          const validated = validateBitrateKbps(String(action.kbps), maxBitrateBps);
          if (!validated.ok) throw badRequest(validated.message);
          break;
        }
        case "setLocked":
        case "setHidden":
          break;
        case "permit":
        case "deny": {
          if (action.targetType === "role") {
            // @everyone(id == guildId)は対象外。
            const roles = await ctx.getGuildRoles(input.guildId);
            if (action.targetId === input.guildId || !roles.some((r) => r.id === action.targetId)) {
              throw badRequest("targetId is not a role of this guild");
            }
            if (action.type === "deny" && (await isDenyProtectedRole(ctx.db, input.guildId, action.targetId))) {
              throw badRequest("このロールは拒否指定できません(サーバー管理者が保護しています)。");
            }
          } else if (!(await ctx.isGuildMember(input.guildId, action.targetId))) {
            throw badRequest("targetId is not a member of this guild");
          }
          break;
        }
        case "removeOverride":
          break;
        case "transferOwner": {
          const state = (await readTempVoiceStates(ctx.readRedisHash, input.guildId)).get(input.channelId);
          if (action.userId === row.ownerId || !state?.members.some((m) => m.userId === action.userId)) {
            throw badRequest("userId is not another member currently in the channel");
          }
          if (await findOwnedTempVoiceChannelId(ctx.db, input.guildId, action.userId)) {
            throw badRequest("選択されたメンバーは既に別の一時VCのオーナーです。");
          }
          break;
        }
      }

      const requestId = updateChannelWait.newRequestId();
      await notifyTempVoiceChannelAction(ctx.db, {
        requestId,
        guildId: input.guildId,
        channelId: input.channelId,
        executorId: ctx.discordUserId,
        action,
      });

      // botの反映結果(Redis)を待ち、失敗・無応答をDashboardに返す。
      const result = await waitForTempVoiceActionResult(ctx.readRedisHash, input.guildId, requestId, updateChannelWait);
      if (!result) {
        throw new TRPCError({ code: "TIMEOUT", message: "Botから応答がありません。Botが起動しているか確認してください。" });
      }
      if (!result.ok) throw badRequest(ACTION_FAILURE_MESSAGES[result.reason]);
    }),

  /** そのVCの個別許可/拒否の一覧。ユーザー名・ロール名を付けて返す(解決できなければname未設定)。 */
  getChannelOverrides: protectedProcedure
    .input(channelInput)
    .use(requireGuildMember())
    .query(async ({ ctx, input }) => {
      await requireEditableChannel(ctx, input.guildId, input.channelId);
      const overrides = await listPermissionOverrides(ctx.db, input.channelId);
      if (overrides.length === 0) return [];
      const [memberNames, roles] = await Promise.all([
        ctx.getGuildMemberNames(input.guildId, overrides.filter((o) => o.targetType === "user").map((o) => o.targetId)),
        ctx.getGuildRoles(input.guildId),
      ]);
      const roleNames = new Map(roles.map((r) => [r.id, r.name]));
      return overrides.map((o): ChannelOverride => ({
        targetType: o.targetType,
        targetId: o.targetId,
        state: o.state,
        name: o.targetType === "user" ? memberNames.get(o.targetId) : roleNames.get(o.targetId),
      }));
    }),

  /** 個別許可/拒否の候補(ID直接入力禁止のためセレクター用)。メンバーはafterでページ送りする。@everyoneは除外。 */
  listOverrideTargetOptions: protectedProcedure
    .input(overrideTargetOptionsInput)
    .use(requireGuildMember())
    .query(async ({ ctx, input }) => {
      await requireEditableChannel(ctx, input.guildId, input.channelId);
      const [page, roles] = await Promise.all([
        ctx.getGuildMembersPage(input.guildId, input.after),
        ctx.getGuildRoles(input.guildId),
      ]);
      return {
        members: page.members,
        nextAfter: page.nextAfter,
        roles: roles.filter((r) => r.id !== input.guildId),
      };
    }),

  forceDelete: tempVoiceManageProcedure(forceDeleteInput)
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
  listVoiceChannelOptions: tempVoiceManageProcedure(guildIdInput)
    .query(({ ctx, input }) => ctx.getGuildVoiceChannelOptions(input.guildId)),

  /** Dashboard UIでのID直接入力を禁止するため、選択肢(実在カテゴリ)をこのprocedure経由で提供する。 */
  listCategoryOptions: tempVoiceManageProcedure(guildIdInput)
    .query(({ ctx, input }) => ctx.getGuildCategoryOptions(input.guildId)),

  /** 拒否禁止ロールタブのロール選択肢。MANAGE_MODERATION権限を要求するmoderationRouter.listRoleOptionsとは
   * 別に、MANAGE_TEMP_VOICE権限者が呼べるようここに用意する。 */
  listRoleOptions: tempVoiceManageProcedure(guildIdInput)
    .query(({ ctx, input }) => ctx.getGuildRoles(input.guildId)),
});
