import { parseEnv, envSchema } from "@management-bot/config";
import { createDb, stopJobOnSignal } from "@management-bot/db";
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

// inFlight(run-purge.ts)により同時実行は常に1つに制限されているため、プールは1で足りる。
const { db, close } = createDb(env.DATABASE_URL, { max: 1 });
const runner = createPurgeRunner(db);

const task = cron.schedule(env.LOGGING_RETENTION_CRON, () => void runner.run(), { timezone: TIMEZONE });

// cronのタイマーを止めてから実行中のジョブ完了を待ち、DBを閉じる(stopJobOnSignal参照)。
stopJobOnSignal(task, runner, close);

console.log(`Logging retention cron scheduled: ${env.LOGGING_RETENTION_CRON} (${TIMEZONE})`);
