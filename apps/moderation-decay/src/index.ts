import { parseEnv, envSchema } from "@management-bot/config";
import { createDb, stopJobOnSignal } from "@management-bot/db";
import cron from "node-cron";
import { createDecayRunner } from "./run-decay.js";

const decayEnvSchema = envSchema.pick({
  DATABASE_URL: true,
  MODERATION_DECAY_CRON: true,
});

const env = parseEnv(decayEnvSchema);
const TIMEZONE = "Asia/Tokyo";

if (!cron.validate(env.MODERATION_DECAY_CRON)) {
  throw new Error(`Invalid MODERATION_DECAY_CRON: ${env.MODERATION_DECAY_CRON}`);
}

// inFlight(run-decay.ts)により同時実行は常に1つに制限されているため、プールは1で足りる。
const { db, close } = createDb(env.DATABASE_URL, { max: 1 });
const runner = createDecayRunner(db);

const task = cron.schedule(env.MODERATION_DECAY_CRON, () => void runner.run(), { timezone: TIMEZONE });

// cronのタイマーを止めてから実行中のジョブ完了を待ち、DBを閉じる(stopJobOnSignal参照)。
stopJobOnSignal(task, runner, close);

console.log(`Moderation decay cron scheduled: ${env.MODERATION_DECAY_CRON} (${TIMEZONE})`);
