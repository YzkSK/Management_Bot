import { protectedProcedure, requireCapability, router } from "@management-bot/dashboard-access";
import { CAPABILITIES, discordIdSchema } from "@management-bot/shared";
import { z } from "zod";
import { listRoles } from "../application/index.js";

const guildIdInput = z.object({ guildId: discordIdSchema });

// requireCapabilityは検証済みinputのguildIdを読むため、`.input()`の後に`.use()`する(scheduled-postと同じ)。
export const roleManagementRouter = router({
  /** ギルドのロール一覧(Discordのロール順)。Bot未参加・権限不足の場合は空一覧を返す。 */
  list: protectedProcedure
    .input(guildIdInput)
    .use(requireCapability(CAPABILITIES.VIEW_ROLES))
    .query(({ ctx, input }) => listRoles(ctx, input.guildId)),
});
