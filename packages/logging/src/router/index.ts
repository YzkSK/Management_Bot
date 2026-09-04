import { protectedProcedure, requireCapability, router } from "@management-bot/dashboard-access";
import { CAPABILITIES, LOG_CATEGORIES, hasCapability } from "@management-bot/shared";
import { z } from "zod";
import { listLogEntries, maskSensitiveFields } from "../application/index.js";

const listLogEntriesInput = z.object({
  guildId: z.string().min(1),
  category: z.enum(LOG_CATEGORIES).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.iso.datetime().optional(),
});

export const loggingRouter = router({
  listLogEntries: protectedProcedure
    .input(listLogEntriesInput)
    .use(requireCapability(CAPABILITIES.VIEW_LOGS))
    .query(async ({ ctx, input }) => {
      const result = await listLogEntries(ctx.db, input);
      const hasRawAccess = hasCapability(ctx.capabilities, CAPABILITIES.VIEW_LOGS_RAW);

      return {
        entries: result.entries.map(({ id, entry }) => ({
          id,
          entry: hasRawAccess ? entry : maskSensitiveFields(entry),
        })),
        nextCursor: result.nextCursor,
      };
    }),
});
