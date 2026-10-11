import { parseEnv, envSchema } from "@management-bot/config";
import {
  BACKUP_FILES_KEY,
  BACKUP_REQUEST_KEY,
  BACKUP_REQUEST_POLL_MS,
  installFatalErrorHandlers,
  startInfraReporter,
} from "@management-bot/shared";
import { Redis } from "ioredis";
import cron from "node-cron";
import { backupOnce, listDumps } from "./dump.js";

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

const redis = new Redis(env.REDIS_URL);
const reporter = startInfraReporter(redis, { name: "backup", service: "worker" });
let running = false;

// ダッシュボードに出すバックアップ一覧をRedisへ書く(ボリュームを共有しないため, issue #629)。
async function publishFiles() {
  try {
    const files = await listDumps(env.BACKUP_DIR);
    await redis.set(BACKUP_FILES_KEY, JSON.stringify({ updatedAt: new Date().toISOString(), files }));
  } catch (error) {
    console.error("Failed to publish backup files:", error);
  }
}

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
    await publishFiles();
  }
}

cron.schedule(env.BACKUP_CRON, () => void runBackup(), { timezone: TIMEZONE });
void publishFiles();
// ダッシュボードの「今すぐバックアップ」要求を拾う(issue #629)。実行中なら runBackup 側でスキップされる。
setInterval(() => {
  redis
    .getdel(BACKUP_REQUEST_KEY)
    .then((requested) => {
      if (requested) void runBackup();
    })
    .catch((error: unknown) => console.error("Failed to poll backup request:", error));
}, BACKUP_REQUEST_POLL_MS);
console.log(
  `Backup cron scheduled: ${env.BACKUP_CRON} (${TIMEZONE}, dir: ${env.BACKUP_DIR}, retention: ${env.BACKUP_RETENTION_DAYS}d)`,
);
