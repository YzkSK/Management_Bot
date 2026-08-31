import { parseEnv, envSchema } from "@management-bot/config";
import { createDb } from "@management-bot/db";
import cron from "node-cron";
import { createPurgeRunner } from "./run-purge.js";

const retentionEnvSchema = envSchema.pick({
  DATABASE_URL: true,
  LOGGING_RETENTION_CRON: true,
});

const env = parseEnv(retentionEnvSchema);
const TIMEZONE = "Asia/Tokyo";

if (!cron.validate(env.LOGGING_RETENTION_CRON)) {
  throw new Error(`Invalid LOGGING_RETENTION_CRON: ${env.LOGGING_RETENTION_CRON}`);
}

const { db, close } = createDb(env.DATABASE_URL);
const runPurge = createPurgeRunner(db);

process.once("SIGTERM", () => void close());
process.once("SIGINT", () => void close());

cron.schedule(env.LOGGING_RETENTION_CRON, () => void runPurge(), { timezone: TIMEZONE });
console.log(`Logging retention cron scheduled: ${env.LOGGING_RETENTION_CRON} (${TIMEZONE})`);
