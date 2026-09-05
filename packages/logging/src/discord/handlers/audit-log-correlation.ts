import type { FeatureModuleContext } from "@management-bot/core";
import { AuditLogEvent, type GuildAuditLogsEntry } from "discord.js";
import type { AuditLogEntryInfo, WriteLogEntryDeps } from "../../application/index.js";
import { correlateAuditLogEntry } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";

/**
 * MemberRoleUpdateのchangesは`$add`/`$remove`キーでロール配列(id/name)を持つ。
 * role所属変更ログ(#49 handlers/role.ts)はroleId+userIdの複合一致で相関するため、
 * ここでroleIdの集合に変換しておく。
 */
function extractRoleChanges(entry: GuildAuditLogsEntry): { added: string[]; removed: string[] } | undefined {
  if (entry.action !== AuditLogEvent.MemberRoleUpdate) return undefined;
  const added: string[] = [];
  const removed: string[] = [];
  for (const change of entry.changes) {
    if (change.key === "$add") added.push(...(change.new ?? []).map((role) => role.id));
    if (change.key === "$remove") removed.push(...(change.new ?? []).map((role) => role.id));
  }
  return { added, removed };
}

/**
 * MessageDeleteのtargetId(投稿者ID)だけでは対象チャンネルを特定できないため、
 * extra.channel.idから取得する。それ以外のactionではundefined。
 * Discord APIのaudit log optional infoは仕様上欠損し得るため、extra/channel/idの
 * いずれかが欠けている場合もエラーにせずundefinedを返す(codexレビュー指摘)。
 */
function extractMessageDeleteChannelId(entry: GuildAuditLogsEntry): string | undefined {
  if (entry.action !== AuditLogEvent.MessageDelete) return undefined;
  const extra = entry.extra as { channel?: { id?: unknown } } | null | undefined;
  const channelId = extra?.channel?.id;
  return typeof channelId === "string" ? channelId : undefined;
}

/** AuditLogEvent(数値enum)を名前文字列へ変換する。未知の値(将来追加分等)は数値文字列にフォールバックする。 */
export function toAuditLogEntryInfo(entry: GuildAuditLogsEntry, guildId: string): AuditLogEntryInfo {
  return {
    id: entry.id,
    guildId,
    action: AuditLogEvent[entry.action] ?? String(entry.action),
    executorId: entry.executorId,
    targetId: entry.targetId,
    createdAt: entry.createdAt.toISOString(),
    roleChanges: extractRoleChanges(entry),
    messageDeleteChannelId: extractMessageDeleteChannelId(entry),
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
