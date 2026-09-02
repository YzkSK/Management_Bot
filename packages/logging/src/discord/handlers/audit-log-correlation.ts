import type { FeatureModuleContext } from "@management-bot/core";
import { AuditLogEvent, type GuildAuditLogsEntry } from "discord.js";
import type { AuditLogEntryInfo, WriteLogEntryDeps } from "../../application/index.js";
import { correlateAuditLogEntry } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";

/** AuditLogEvent(数値enum)を名前文字列へ変換する。未知の値(将来追加分等)は数値文字列にフォールバックする。 */
export function toAuditLogEntryInfo(entry: GuildAuditLogsEntry, guildId: string): AuditLogEntryInfo {
  return {
    id: entry.id,
    guildId,
    action: AuditLogEvent[entry.action] ?? String(entry.action),
    executorId: entry.executorId,
    targetId: entry.targetId,
    createdAt: entry.createdAt.toISOString(),
  };
}

/**
 * #49〜#51の各イベントハンドラとは異なり、単一のwriteLogEntry呼び出しではなく
 * correlateAuditLogEntry(生ログ保存+既存行への実行者追記)という複合処理のため、
 * writeLogEntrySafelyではなくここで個別にエラーを握りつぶす(discord.jsのリスナーに再配送はない)。
 */
export function registerAuditLogCorrelationHandlers(ctx: FeatureModuleContext): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx) };

  ctx.client.on("guildAuditLogEntryCreate", (entry, guild) => {
    void correlateAuditLogEntry(deps, toAuditLogEntryInfo(entry, guild.id)).catch((error: unknown) => {
      console.error("Failed to correlate audit log entry", error);
    });
  });
}
