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
const runner = createPurgeRunner(db);

const task = cron.schedule(env.LOGGING_RETENTION_CRON, () => void runner.run(), { timezone: TIMEZONE });

// cronのタイマーを止めてから実行中のジョブ(DELETE)完了を待ち、DBを閉じる。
// タイマーを止めずにcloseだけ呼ぶとプロセスがtimer keep-aliveで終了しない。
async function shutdown() {
  task.stop();
  await runner.waitForIdle();
  await close();
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

console.log(`Logging retention cron scheduled: ${env.LOGGING_RETENTION_CRON} (${TIMEZONE})`);
