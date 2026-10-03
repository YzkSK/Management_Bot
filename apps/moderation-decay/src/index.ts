import { parseEnv, envSchema } from "@management-bot/config";
import { createDb, stopJobOnSignal } from "@management-bot/db";
import { installFatalErrorHandlers, startInfraReporter } from "@management-bot/shared";
import { Redis } from "ioredis";
import cron from "node-cron";
import { createDecayRunner } from "./run-decay.js";

const decayEnvSchema = envSchema.pick({
  DATABASE_URL: true,
  REDIS_URL: true,
  MODERATION_DECAY_CRON: true,
});

installFatalErrorHandlers("moderation-decay");
const env = parseEnv(decayEnvSchema);
const TIMEZONE = "Asia/Tokyo";

if (!cron.validate(env.MODERATION_DECAY_CRON)) {
  throw new Error(`Invalid MODERATION_DECAY_CRON: ${env.MODERATION_DECAY_CRON}`);
}

// inFlight(run-decay.ts)により同時実行は常に1つに制限されているため、プールは1で足りる。
const { db, close } = createDb(env.DATABASE_URL, { max: 1 });
const reporter = startInfraReporter(new Redis(env.REDIS_URL), { name: "moderation-decay", service: "worker" });
const runner = createDecayRunner(
  db,
  (message) => {
    console.log(message);
    // 他の実行・レプリカがロック中でスキップした場合(createAdvisoryLockRunner)は実行成功として記録しない。
    if (!message.startsWith("Skipping ")) reporter.recordRun(true);
  },
  (error) => {
    console.error("moderation-decay job failed:", error);
    reporter.recordRun(false);
  },
);

const task = cron.schedule(env.MODERATION_DECAY_CRON, () => void runner.run(), { timezone: TIMEZONE });

// cronのタイマーを止めてから実行中のジョブ完了を待ち、DBを閉じる(stopJobOnSignal参照)。
stopJobOnSignal(task, runner, close);

console.log(`Moderation decay cron scheduled: ${env.MODERATION_DECAY_CRON} (${TIMEZONE})`);
