import { parseEnv, envSchema } from "@management-bot/config";
import { createDb, stopJobOnSignal } from "@management-bot/db";
import cron from "node-cron";
import { createCleanupRunner } from "./run-cleanup.js";

const cleanupEnvSchema = envSchema.pick({
  DATABASE_URL: true,
  SESSION_CLEANUP_CRON: true,
});

const env = parseEnv(cleanupEnvSchema);
const TIMEZONE = "Asia/Tokyo";

if (!cron.validate(env.SESSION_CLEANUP_CRON)) {
  throw new Error(`Invalid SESSION_CLEANUP_CRON: ${env.SESSION_CLEANUP_CRON}`);
}

// inFlight(run-cleanup.ts)により同時実行は常に1つに制限されているため、プールは1で足りる。
const { db, close } = createDb(env.DATABASE_URL, { max: 1 });
const runner = createCleanupRunner(db);

const task = cron.schedule(env.SESSION_CLEANUP_CRON, () => void runner.run(), { timezone: TIMEZONE });

// cronのタイマーを止めてから実行中のジョブ完了を待ち、DBを閉じる(stopJobOnSignal参照)。
stopJobOnSignal(task, runner, close);

console.log(`Session cleanup cron scheduled: ${env.SESSION_CLEANUP_CRON} (${TIMEZONE})`);
