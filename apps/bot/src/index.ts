import { parseEnv, envSchema } from "@management-bot/config";
import { BotClient, DomainEventBus } from "@management-bot/core";
import { createDb, onboardGuild, syncFeatureMetadata } from "@management-bot/db";
import { buildInviteUrl, mapWithConcurrency } from "@management-bot/shared";
import { FEATURES } from "./features.js";

/**
 * 起動時に多数のguildへ同時にonboardGuild(3 INSERTのトランザクション)を実行すると
 * Postgresの接続プールを圧迫するため、並行数を制限する(issue #223)。
 */
const ONBOARD_CONCURRENCY = 10;

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
  await client.runShutdownCleanups();
  await close();
};
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

try {
  await syncFeatureMetadata(db);
  await client.registerFeatures(FEATURES, {
    db,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    eventBusFor: (feature) => eventBuses.get(feature.key)!,
  });

  const onboard = (guild: { id: string; name: string; ownerId: string }) =>
    onboardGuild(db, {
      guildId: guild.id,
      guildName: guild.name,
      ownerId: guild.ownerId,
    }).catch((error: unknown) => {
      console.error(`Failed to onboard guild ${guild.id}`, error);
    });

  const track = (task: Promise<void>) => {
    pendingOnboardings.add(task);
    void task.finally(() => pendingOnboardings.delete(task));
  };

  client.once("ready", (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
    console.log(`Invite URL: ${buildInviteUrl(env.DISCORD_CLIENT_ID)}`);
    // guildCreateは新規参加時のみ発火するため、起動時点で既に参加済みのguildはここで同期する。
    // 多数のguildに参加している場合の接続プール圧迫を避けるため、並行数を制限する(issue #223)。
    track(
      mapWithConcurrency([...readyClient.guilds.cache.values()], ONBOARD_CONCURRENCY, onboard).then(() => undefined),
    );
  });

  client.on("guildCreate", (guild) => track(onboard(guild)));

  await client.login(env.DISCORD_TOKEN);
} catch (error) {
  await shutdown();
  throw error;
}
