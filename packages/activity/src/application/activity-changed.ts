import type { Redis } from "ioredis";
import { type ActivityChangeKind, activityChangedChannel } from "../domain/index.js";

export async function publishActivityChanged(redis: Redis, guildId: string, kind: ActivityChangeKind): Promise<void> {
  await redis.publish(activityChangedChannel(guildId), JSON.stringify({ kind }));
}
