import { parseEnv, envSchema } from "@management-bot/config";
import { BotClient, DomainEventBus } from "@management-bot/core";
import { createDb, onboardGuild, syncFeatureMetadata } from "@management-bot/db";
import { FEATURES } from "./features.js";
import { buildInviteUrl } from "./invite-url.js";

const botEnvSchema = envSchema.pick({
  DATABASE_URL: true,
  REDIS_URL: true,
  DISCORD_TOKEN: true,
  DISCORD_CLIENT_ID: true,
});

const env = parseEnv(botEnvSchema);

const { db, close } = createDb(env.DATABASE_URL);
const client = new BotClient();
const pendingOnboardings = new Set<Promise<void>>();
// consumerGroupは機能ごとに一意にする(DomainEventBus参照)。同一typeを複数機能が
// 同じgroupで購読すると配送を取り合うため、機能キーをそのままgroup名に使う。
const eventBuses = new Map(FEATURES.map((feature) => [feature.key, new DomainEventBus(env.REDIS_URL, feature.key)]));

const shutdown = async () => {
  client.destroy();
  await Promise.allSettled(pendingOnboardings);
  await Promise.all([...eventBuses.values()].map((bus) => bus.close()));
  await close();
};
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

try {
  await syncFeatureMetadata(db);
  await client.registerFeatures(FEATURES, {
    db,
    eventBusFor: (feature) => eventBuses.get(feature.key)!,
  });

  client.once("ready", (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
    console.log(`Invite URL: ${buildInviteUrl(env.DISCORD_CLIENT_ID)}`);
  });

  client.on("guildCreate", (guild) => {
    const task = onboardGuild(db, {
      guildId: guild.id,
      guildName: guild.name,
      ownerId: guild.ownerId,
    }).catch((error: unknown) => {
      console.error(`Failed to onboard guild ${guild.id}`, error);
    });
    pendingOnboardings.add(task);
    void task.finally(() => pendingOnboardings.delete(task));
  });

  await client.login(env.DISCORD_TOKEN);
} catch (error) {
  await shutdown();
  throw error;
}
