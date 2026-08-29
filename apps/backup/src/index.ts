import { parseEnv, envSchema } from "@management-bot/config";
import cron from "node-cron";
import { backupOnce } from "./dump.js";

const backupEnvSchema = envSchema.pick({
  DATABASE_URL: true,
  BACKUP_CRON: true,
  BACKUP_DIR: true,
  BACKUP_RETENTION_DAYS: true,
});

const env = parseEnv(backupEnvSchema);
const TIMEZONE = "Asia/Tokyo";

if (!cron.validate(env.BACKUP_CRON)) {
  throw new Error(`Invalid BACKUP_CRON: ${env.BACKUP_CRON}`);
}

let running = false;

async function runBackup() {
  if (running) {
    console.warn("Skipping backup: previous run is still active");
    return;
  }
  running = true;
  try {
    const outFile = await backupOnce(env.DATABASE_URL, env.BACKUP_DIR, env.BACKUP_RETENTION_DAYS);
    console.log(`Backup written: ${outFile}`);
  } catch (error) {
    console.error("Backup failed:", error);
  } finally {
    running = false;
  }
}

cron.schedule(env.BACKUP_CRON, () => void runBackup(), { timezone: TIMEZONE });
console.log(
  `Backup cron scheduled: ${env.BACKUP_CRON} (${TIMEZONE}, dir: ${env.BACKUP_DIR}, retention: ${env.BACKUP_RETENTION_DAYS}d)`,
);
