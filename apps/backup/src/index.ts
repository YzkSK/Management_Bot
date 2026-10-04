import { parseEnv, envSchema } from "@management-bot/config";
import { installFatalErrorHandlers, startInfraReporter } from "@management-bot/shared";
import { Redis } from "ioredis";
import cron from "node-cron";
import { backupOnce } from "./dump.js";

const backupEnvSchema = envSchema.pick({
  DATABASE_URL: true,
  REDIS_URL: true,
  BACKUP_CRON: true,
  BACKUP_DIR: true,
  BACKUP_RETENTION_DAYS: true,
  BACKUP_AGE_RECIPIENT: true,
});

installFatalErrorHandlers("backup");
const env = parseEnv(backupEnvSchema);
const TIMEZONE = "Asia/Tokyo";

if (!cron.validate(env.BACKUP_CRON)) {
  throw new Error(`Invalid BACKUP_CRON: ${env.BACKUP_CRON}`);
}
// 形式チェック(env.ts)はチェックサムまで見ないため、起動時にage自身で公開鍵を検証し、
// 不正な鍵のまま定期バックアップが全て失敗し続けるのを防ぐ(#567)。
// stdinは"ignore"(/dev/null)にして即EOFを渡す(空のバッファだとEOFが届かずageが待ち続ける)。
const ageCheck = Bun.spawnSync(["age", "-r", env.BACKUP_AGE_RECIPIENT], { stdin: "ignore", stdout: "ignore" });
if (ageCheck.exitCode !== 0) {
  throw new Error(`Invalid BACKUP_AGE_RECIPIENT: ${ageCheck.stderr.toString().trim()}`);
}

const reporter = startInfraReporter(new Redis(env.REDIS_URL), { name: "backup", service: "worker" });
let running = false;

async function runBackup() {
  if (running) {
    console.warn("Skipping backup: previous run is still active");
    return;
  }
  running = true;
  try {
    const outFile = await backupOnce(
      env.DATABASE_URL,
      env.BACKUP_DIR,
      env.BACKUP_RETENTION_DAYS,
      env.BACKUP_AGE_RECIPIENT,
    );
    console.log(`Backup written: ${outFile}`);
    reporter.recordRun(true);
  } catch (error) {
    console.error("Backup failed:", error);
    reporter.recordRun(false);
  } finally {
    running = false;
  }
}

cron.schedule(env.BACKUP_CRON, () => void runBackup(), { timezone: TIMEZONE });
console.log(
  `Backup cron scheduled: ${env.BACKUP_CRON} (${TIMEZONE}, dir: ${env.BACKUP_DIR}, retention: ${env.BACKUP_RETENTION_DAYS}d)`,
);
