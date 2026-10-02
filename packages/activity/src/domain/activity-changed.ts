import { z } from "zod";

/** botからdashboard-apiへの「集計値が変わった」通知(Redis Pub/Sub)。本文は含めず、画面側でtRPCから取り直す。 */
const PREFIX = "activity:changed:";
export const ACTIVITY_CHANGED_PATTERN = `${PREFIX}*`;

const payloadSchema = z.object({ kind: z.enum(["stats", "voice"]) });
export type ActivityChangeKind = z.infer<typeof payloadSchema>["kind"];

export function activityChangedChannel(guildId: string): string {
  return `${PREFIX}${guildId}`;
}

export function parseActivityChanged(
  channel: string,
  message: string,
): { guildId: string; kind: ActivityChangeKind } | undefined {
  if (!channel.startsWith(PREFIX) || channel.length === PREFIX.length) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(message);
  } catch {
    return undefined;
  }
  const result = payloadSchema.safeParse(json);
  return result.success ? { guildId: channel.slice(PREFIX.length), kind: result.data.kind } : undefined;
}
