import { parseEnv, envSchema } from "@management-bot/config";
import { createDb, stopJobOnSignal } from "@management-bot/db";
import { startInfraReporter } from "@management-bot/shared";
import { Redis } from "ioredis";
import cron from "node-cron";
import { createRollupRunner } from "./run-rollup.js";

const rollupEnvSchema = envSchema.pick({
  DATABASE_URL: true,
  REDIS_URL: true,
  ACTIVITY_ROLLUP_CRON: true,
});

const env = parseEnv(rollupEnvSchema);
const TIMEZONE = "Asia/Tokyo";

if (!cron.validate(env.ACTIVITY_ROLLUP_CRON)) {
  throw new Error(`Invalid ACTIVITY_ROLLUP_CRON: ${env.ACTIVITY_ROLLUP_CRON}`);
}

// inFlight(run-rollup.ts)により同時実行は常に1つに制限されているため、プールは1で足りる。
const { db, close } = createDb(env.DATABASE_URL, { max: 1 });
const reporter = startInfraReporter(new Redis(env.REDIS_URL), { name: "activity-rollup", service: "worker" });
const runner = createRollupRunner(
  db,
  (message) => {
    console.log(message);
    // 他の実行・レプリカがロック中でスキップした場合(createAdvisoryLockRunner)は実行成功として記録しない。
    if (!message.startsWith("Skipping ")) reporter.recordRun(true);
  },
  (error) => {
    console.error("activity-rollup job failed:", error);
    reporter.recordRun(false);
  },
);

const task = cron.schedule(env.ACTIVITY_ROLLUP_CRON, () => void runner.run(), { timezone: TIMEZONE });

// cronのタイマーを止めてから実行中のジョブ完了を待ち、DBを閉じる(stopJobOnSignal参照)。
stopJobOnSignal(task, runner, close);

console.log(`Activity rollup cron scheduled: ${env.ACTIVITY_ROLLUP_CRON} (${TIMEZONE})`);
