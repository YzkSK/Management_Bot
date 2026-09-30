import { createRequire } from "node:module";
import { parseEnv, envSchema } from "@management-bot/config";
import { BotClient, DomainEventBus } from "@management-bot/core";
import { createDb, onboardGuild, syncFeatureMetadata } from "@management-bot/db";
import { buildInviteUrl, HEARTBEAT_INTERVAL_MS, mapWithConcurrency, startInfraReporter } from "@management-bot/shared";
import { Redis } from "ioredis";
import { FEATURES } from "./features.js";
import { applyAppEmojis, syncAppEmojis } from "./sync-app-emojis.js";

const getReleaseVersion = (): string => {
  try {
    const manifest = createRequire(import.meta.url)("../../../package.json") as { version?: unknown };
    return typeof manifest.version === "string" && manifest.version !== "" ? manifest.version : "unknown";
  } catch (error) {
    console.warn("Failed to read release version", error);
    return "unknown";
  }
};
const RELEASE_VERSION = getReleaseVersion();

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
  TEMP_VOICE_GRACE_CRON: true,
});

const env = parseEnv(botEnvSchema);
const infraReporter = startInfraReporter(new Redis(env.REDIS_URL), { name: "bot", service: "bot" });

console.info(`Starting bot v${RELEASE_VERSION}`);

const { db, close } = createDb(env.DATABASE_URL);
const client = new BotClient();
// ステータス画面(issue #507)向け。ready=0ならGateway未接続として停止扱いにする。
// 起動直後とready時にも即座に反映し、接続前の状態を稼働中と誤表示しない。
const reportBotDetail = () =>
  infraReporter.setDetail({
    ready: client.isReady() ? 1 : 0,
    pingMs: client.ws.ping,
    guilds: client.guilds.cache.size,
  });
reportBotDetail();
const botDetailTimer = setInterval(reportBotDetail, HEARTBEAT_INTERVAL_MS);
botDetailTimer.unref();
const pendingOnboardings = new Set<Promise<void>>();
// consumerGroupは機能ごとに一意にする(DomainEventBus参照)。同一typeを複数機能が
// 同じgroupで購読すると配送を取り合うため、機能キーをそのままgroup名に使う。
const eventBuses = new Map(FEATURES.map((feature) => [feature.key, new DomainEventBus(env.REDIS_URL, feature.key)]));

const shutdown = async () => {
  // runShutdownCleanups(cron停止+実行中ジョブの完了待ち等)をclient.destroy()より先に行う
  // (codexレビュー指摘: destroy()を先に呼ぶと、cron停止前に新しいtickが発火し、破棄済みの
  // Discordクライアントでtemp-voiceのオーナー自動再割当(run-grace.ts)がAPI呼び出しに失敗しうる)。
  await client.runShutdownCleanups();
  client.destroy();
  await Promise.allSettled(pendingOnboardings);
  await Promise.all([...eventBuses.values()].map((bus) => bus.close()));
  await close();
  clearInterval(botDetailTimer);
  infraReporter.stop();
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
    env,
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
    reportBotDetail();
    console.log(`Logged in as ${readyClient.user.tag}`);
    console.log(`Invite URL: ${buildInviteUrl(env.DISCORD_CLIENT_ID)}`);
    // 絵文字登録の失敗でBotを止めない(未登録の絵文字は利用側でフォールバックする前提)。
    // 登録後に取得した絵文字をログ通知のアイコン・一時VCパネルに使う。失敗時はUnicode絵文字のまま(#455)。
    const emojiHashStore = new Redis(env.REDIS_URL);
    syncAppEmojis(readyClient.application, emojiHashStore)
      .catch((error: unknown) => console.warn("Failed to sync app emojis", error))
      .finally(() => emojiHashStore.quit())
      .then(() => applyAppEmojis(readyClient.application))
      .catch((error: unknown) => console.warn("Failed to load app emojis", error));
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
