import { protectedProcedure, requireCapability, router } from "@management-bot/dashboard-access";
import { CAPABILITIES, discordIdSchema } from "@management-bot/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getMemberDetail, getMemberRanking, getServerSummary, readActiveVoice } from "../application/index.js";

const PAGE_SIZE = 20;
/** 集計クエリの負荷を抑えるため、1回に指定できる期間の上限を設ける。 */
const MAX_RANGE_MS = 366 * 24 * 3_600_000;

const rangeInput = z.object({ guildId: discordIdSchema, from: z.iso.datetime(), to: z.iso.datetime() });

// requireCapabilityは検証済みinputのguildIdを読むため、`.input()`の後に`.use()`する必要がある。
const activityViewProcedure = <TInput extends z.ZodType<{ guildId: string }>>(input: TInput) =>
  protectedProcedure.input(input).use(requireCapability(CAPABILITIES.VIEW_ACTIVITY));

function toRange(input: { from: string; to: string }): { from: Date; to: Date } {
  const from = new Date(input.from);
  const to = new Date(input.to);
  if (to <= from || to.getTime() - from.getTime() > MAX_RANGE_MS) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "invalid range" });
  }
  return { from, to };
}

export const activityRouter = router({
  serverSummary: activityViewProcedure(rangeInput.extend({ granularity: z.enum(["hour", "day"]) })).query(({ ctx, input }) =>
    getServerSummary(ctx.db, { guildId: input.guildId, granularity: input.granularity, ...toRange(input) }),
  ),

  memberRanking: activityViewProcedure(
    rangeInput.extend({ sort: z.enum(["voice", "messages"]), page: z.number().int().min(0) }),
  ).query(async ({ ctx, input }) => {
    const result = await getMemberRanking(ctx.db, {
      guildId: input.guildId,
      sort: input.sort,
      limit: PAGE_SIZE,
      offset: input.page * PAGE_SIZE,
      ...toRange(input),
    });
    const ids = result.rows.map((r) => r.userId);
    const names = ids.length > 0 ? await ctx.getGuildMemberNames(input.guildId, ids) : new Map<string, string>();
    return {
      ...result,
      pageSize: PAGE_SIZE,
      rows: result.rows.map((r) => ({ ...r, name: names.get(r.userId) ?? null })),
    };
  }),

  memberDetail: activityViewProcedure(rangeInput.extend({ userId: discordIdSchema })).query(({ ctx, input }) =>
    getMemberDetail(ctx.db, { guildId: input.guildId, userId: input.userId, ...toRange(input) }),
  ),

  /** Dashboard UIでのID直接入力を禁止するため、メンバーの選択肢をこのprocedure経由で提供する。 */
  listMemberOptions: activityViewProcedure(
    z.object({ guildId: discordIdSchema, after: z.string().min(1).optional() }),
  ).query(({ ctx, input }) => ctx.getGuildMembersPage(input.guildId, input.after)),

  /** 現在VCにいるメンバー(Discordの現在状態。DBには記録しない)。 */
  activeVoice: activityViewProcedure(z.object({ guildId: discordIdSchema })).query(({ ctx, input }) =>
    readActiveVoice(ctx.readRedisHash, input.guildId),
  ),
});
