import { z } from "zod";

export const envSchema = z.object({
  // DB
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => /^postgres(ql)?:\/\//.test(value), {
      message: "DATABASE_URL must use postgres:// or postgresql://",
    }),

  // Redis
  REDIS_URL: z
    .string()
    .url()
    .refine((value) => /^rediss?:\/\//.test(value), {
      message: "REDIS_URL must use redis:// or rediss://",
    }),

  // Discord
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  DISCORD_OAUTH_REDIRECT_URI: z.string().url(),

  // Dashboard
  DASHBOARD_WEB_URL: z.string().url(),

  // ステータス画面のリソース表示(issue #548)。未設定ならサンプリングしない。
  CADVISOR_URL: z.string().url().optional(),
  // コンテナ別表示用のdocker-socket-proxy。未設定ならコンテナ別は空になる。
  DOCKER_API_URL: z.string().url().optional(),

  // セッション
  SESSION_SECRET: z.string().min(32),

  // バックアップ
  BACKUP_CRON: z.string().min(1).default("0 3 * * *"),
  BACKUP_DIR: z.string().min(1).default("/backups"),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
  // ageの公開鍵(受信者)。必須(デフォルトなし)にして、未設定なら平文のダンプを書かず起動を失敗させる。
  // age公開鍵はbech32("age1"+58文字)。起動時に形式を検証し、不正な鍵でバックアップ時に初めて失敗するのを防ぐ。
  BACKUP_AGE_RECIPIENT: z
    .string()
    .regex(/^age1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}$/, "BACKUP_AGE_RECIPIENT must be an age public key (age1...)"),

  // ログ保持期限ジョブ
  LOGGING_RETENTION_CRON: z.string().min(1).default("0 4 * * *"),

  // モデレーションストライク減衰ジョブ
  MODERATION_DECAY_CRON: z.string().min(1).default("0 * * * *"),

  // 一時VCオーナー自動再割当ジョブ
  TEMP_VOICE_GRACE_CRON: z.string().min(1).default("* * * * *"),

  // アクティビティ集計のロールアップジョブ(90日超の時間単位集計を日次へ)
  ACTIVITY_ROLLUP_CRON: z.string().min(1).default("15 4 * * *"),

  // 期限切れDashboardセッション削除ジョブ
  SESSION_CLEANUP_CRON: z.string().min(1).default("30 4 * * *"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined> = process.env,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    console.error("Invalid environment variables:", z.treeifyError(result.error));
    throw new Error("Invalid environment variables");
  }
  return result.data;
}
