import { trpcServer } from "@hono/trpc-server";
import { parseEnv, envSchema } from "@management-bot/config";
import { createDb, listenForLogEntryInserts } from "@management-bot/db";
import { Hono } from "hono";
import { Redis } from "ioredis";
import { cors } from "hono/cors";
import { createTtlCache, startInfraReporter, type ResourceSample } from "@management-bot/shared";
import { createAppRouter } from "./app-router.js";
import { fetchBotOwners, type BotOwner } from "./discord/bot-client.js";
import { collectStatus } from "./status/collect-status.js";
import { readInfraLogs, subscribeInfraLogIngest } from "./status/infra-logs.js";
import { fetchResourceSample, readResourceSamples, startResourceSampler } from "./status/resources.js";
import { createContext } from "./context.js";
import { createOAuthRoutes } from "./oauth/routes.js";
import { broadcastNewLogEntry } from "./ws/log-broadcaster.js";
import { subscribeActivityChanges } from "./ws/activity-broadcaster.js";
import { createWsRoutes } from "./ws/routes.js";

const dashboardEnvSchema = envSchema.pick({
  DATABASE_URL: true,
  DISCORD_CLIENT_ID: true,
  DISCORD_CLIENT_SECRET: true,
  DISCORD_OAUTH_REDIRECT_URI: true,
  DASHBOARD_WEB_URL: true,
  SESSION_SECRET: true,
  DISCORD_TOKEN: true,
  REDIS_URL: true,
  CADVISOR_URL: true,
});

const env = parseEnv(dashboardEnvSchema);
const { db } = createDb(env.DATABASE_URL);
// lazyConnect: 最初の利用(アクティブVC取得・変更通知の購読)まで接続しない。
const redis = new Redis(env.REDIS_URL, { lazyConnect: true });
startInfraReporter(redis, { name: "api", service: "api" });
// オーナーはDeveloper Portalでしか変わらないため数分キャッシュする(issue #507)。
const botOwnersCache = createTtlCache<readonly BotOwner[]>(5 * 60_000);
// 閲覧者ごとの5秒ポーリングをまとめ、cAdvisorへの問い合わせを閲覧者数に比例させない(issue #548)。
const currentResourcesCache = createTtlCache<ResourceSample | null>(4_000);
const appRouter = createAppRouter({
  getBotOwners: () => botOwnersCache("owners", () => fetchBotOwners(env.DISCORD_TOKEN)),
  collectStatus: () => collectStatus(db, redis),
  readLogs: (service) => readInfraLogs(redis, service),
  readResources: (range) => readResourceSamples(redis, range),
  readCurrentResources: async () => {
    const url = env.CADVISOR_URL;
    return url ? currentResourcesCache("now", () => fetchResourceSample(url)) : null;
  },
});
// cAdvisorが無い環境(ローカル等)ではリソースのサンプリングを起動しない(issue #548)。
if (env.CADVISOR_URL) startResourceSampler(redis, env.CADVISOR_URL);
const isProduction = process.env.NODE_ENV === "production";

const app = new Hono();

app.use("/trpc/*", cors({ origin: env.DASHBOARD_WEB_URL, credentials: true }));
app.use("/auth/logout", cors({ origin: env.DASHBOARD_WEB_URL, credentials: true }));

app.route(
  "/auth",
  createOAuthRoutes({
    db,
    discordClientId: env.DISCORD_CLIENT_ID,
    discordClientSecret: env.DISCORD_CLIENT_SECRET,
    discordRedirectUri: env.DISCORD_OAUTH_REDIRECT_URI,
    sessionSecret: env.SESSION_SECRET,
    successRedirectUrl: env.DASHBOARD_WEB_URL,
    secureCookies: isProduction,
  }),
);

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: createContext(db, env.SESSION_SECRET, env.DISCORD_TOKEN, env.DISCORD_CLIENT_ID, redis),
  }),
);

const { app: wsApp, websocket } = createWsRoutes(
  db,
  env.SESSION_SECRET,
  env.DISCORD_TOKEN,
  env.DASHBOARD_WEB_URL,
);
app.route("/ws", wsApp);

const logNotifications = listenForLogEntryInserts(env.DATABASE_URL, ({ guildId, category }) =>
  broadcastNewLogEntry(guildId, category),
);
logNotifications.ready.catch((error: unknown) => {
  console.error("Failed to start listening for log entry inserts (dashboard live updates disabled)", error);
});

subscribeActivityChanges(redis).catch((error: unknown) => {
  console.error("Failed to subscribe activity changes (activity live updates disabled)", error);
});

subscribeInfraLogIngest(redis).catch((error: unknown) => {
  console.error("Failed to subscribe infra log ingest (PostgreSQL/Redis logs disabled)", error);
});

export default { fetch: app.fetch, websocket };
