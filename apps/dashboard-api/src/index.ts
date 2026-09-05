import { trpcServer } from "@hono/trpc-server";
import { parseEnv, envSchema } from "@management-bot/config";
import { createDb, listenForLogEntryInserts } from "@management-bot/db";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { appRouter } from "./app-router.js";
import { createContext } from "./context.js";
import { createOAuthRoutes } from "./oauth/routes.js";
import { broadcastNewLogEntry } from "./ws/log-broadcaster.js";
import { createLogWsRoutes } from "./ws/routes.js";

const dashboardEnvSchema = envSchema.pick({
  DATABASE_URL: true,
  DISCORD_CLIENT_ID: true,
  DISCORD_CLIENT_SECRET: true,
  DISCORD_OAUTH_REDIRECT_URI: true,
  DASHBOARD_WEB_URL: true,
  SESSION_SECRET: true,
  DISCORD_TOKEN: true,
});

const env = parseEnv(dashboardEnvSchema);
const { db } = createDb(env.DATABASE_URL);
const isProduction = process.env.NODE_ENV === "production";

const app = new Hono();

app.use("/trpc/*", cors({ origin: env.DASHBOARD_WEB_URL, credentials: true }));

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
    createContext: createContext(db, env.SESSION_SECRET, env.DISCORD_TOKEN),
  }),
);

const { app: wsApp, websocket } = createLogWsRoutes(db, env.SESSION_SECRET);
app.route("/ws", wsApp);

listenForLogEntryInserts(env.DATABASE_URL, ({ guildId, category }) => broadcastNewLogEntry(guildId, category));

export default { fetch: app.fetch, websocket };
