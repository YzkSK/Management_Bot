import { PermissionFlagsBits } from "discord.js";

/**
 * loggingのintegrationカテゴリ・監査ログ相関(#52)はguildAuditLogEntryCreateに依存し、
 * このイベントはBotに「監査ログを見る」権限(View Audit Log)がないguildでは配信されない。
 *
 * CLAUDE.mdのBot権限方針により、初回招待は常に無権限(0)で行い、機能ごとの追加権限は
 * Dashboardの再認可導線からbuildInviteUrl(clientId, permissions)へ渡す形にする
 * (このリポジトリには再認可UIが未実装のため、今はこの定数を用意するに留める)。
 * 再認可導線を実装する際はこの値をloggingの必要権限として使うこと。
 */
export const LOGGING_REQUIRED_PERMISSIONS = PermissionFlagsBits.ViewAuditLog;
