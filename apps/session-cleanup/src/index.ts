import { parseEnv, envSchema } from "@management-bot/config";
import { createDb, stopJobOnSignal } from "@management-bot/db";
import { installFatalErrorHandlers, startInfraReporter } from "@management-bot/shared";
import { Redis } from "ioredis";
import cron from "node-cron";
import { createCleanupRunner } from "./run-cleanup.js";

const cleanupEnvSchema = envSchema.pick({
  DATABASE_URL: true,
  REDIS_URL: true,
  SESSION_CLEANUP_CRON: true,
});

installFatalErrorHandlers("session-cleanup");
const env = parseEnv(cleanupEnvSchema);
const TIMEZONE = "Asia/Tokyo";

if (!cron.validate(env.SESSION_CLEANUP_CRON)) {
  throw new Error(`Invalid SESSION_CLEANUP_CRON: ${env.SESSION_CLEANUP_CRON}`);
}

// inFlight(run-cleanup.ts)により同時実行は常に1つに制限されているため、プールは1で足りる。
const { db, close } = createDb(env.DATABASE_URL, { max: 1 });
const reporter = startInfraReporter(new Redis(env.REDIS_URL), { name: "session-cleanup", service: "worker" });
const runner = createCleanupRunner(
  db,
  (message) => {
    console.log(message);
    // 他の実行・レプリカがロック中でスキップした場合(createAdvisoryLockRunner)は実行成功として記録しない。
    if (!message.startsWith("Skipping ")) reporter.recordRun(true);
  },
  (error) => {
    console.error("session-cleanup job failed:", error);
    reporter.recordRun(false);
  },
);

const task = cron.schedule(env.SESSION_CLEANUP_CRON, () => void runner.run(), { timezone: TIMEZONE });

// cronのタイマーを止めてから実行中のジョブ完了を待ち、DBを閉じる(stopJobOnSignal参照)。
stopJobOnSignal(task, runner, close);

console.log(`Session cleanup cron scheduled: ${env.SESSION_CLEANUP_CRON} (${TIMEZONE})`);
