import type { FeatureModuleContext } from "@management-bot/core";
import { AuditLogEvent, type GuildAuditLogsEntry } from "discord.js";
import type { AuditLogEntryInfo, GetChannelId, WriteLogEntryDeps } from "../../application/index.js";
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

/**
 * MemberUpdateのchangesのうち、サーバーミュート(mute)・サーバースピーカーミュート(deaf)の
 * 変更後の値を取得する。Discord APIのAuditLogChangeKeyはGuildMemberのフィールド名(mute/deaf)を
 * そのまま使うため、shared側のVOICE_STATE_FLAG_NAMES(serverMute/serverDeaf)とは名前が異なる
 * (呼び出し元のcorrelate-audit-log-entry.ts側でserverMute/serverDeafへ変換する)。
 * MemberUpdateはニックネーム変更・タイムアウト等も含む共通actionのため、mute/deafどちらも
 * 変更されていない場合はundefinedを返す(相関自体をスキップさせる)。
 */
function extractMemberUpdateVoiceStateChanges(
  entry: GuildAuditLogsEntry,
): { mute?: boolean; deaf?: boolean; hasOtherChanges: boolean } | undefined {
  if (entry.action !== AuditLogEvent.MemberUpdate) return undefined;
  let mute: boolean | undefined;
  let deaf: boolean | undefined;
  let hasOtherChanges = false;
  for (const change of entry.changes) {
    if (change.key === "mute" && typeof change.new === "boolean") mute = change.new;
    else if (change.key === "deaf" && typeof change.new === "boolean") deaf = change.new;
    else hasOtherChanges = true;
  }
  return mute !== undefined || deaf !== undefined ? { mute, deaf, hasOtherChanges } : undefined;
}

/**
 * MemberDisconnect/MemberMoveのextra.countとextra.channel.id(MemberMoveの移動先)を取得する。
 * それ以外のactionではundefined。Discord APIのaudit log optional infoは仕様上欠損し得るため、
 * 期待した形でない場合もエラーにせずundefinedを返す。
 */
function extractVoiceDisconnectOrMove(entry: GuildAuditLogsEntry): { count: number; moveChannelId?: string } | undefined {
  if (entry.action !== AuditLogEvent.MemberDisconnect && entry.action !== AuditLogEvent.MemberMove) return undefined;
  const extra = entry.extra as { count?: unknown; channel?: { id?: unknown } } | null | undefined;
  const count = extra?.count;
  if (typeof count !== "number") return undefined;
  const channelId = extra?.channel?.id;
  return { count, moveChannelId: typeof channelId === "string" ? channelId : undefined };
}

/**
 * InviteCreate/InviteDeleteはDiscord APIの仕様上target_idが常にnullになる
 * (招待はスナウフレークIDを持たずコード文字列のため)。discord.js(確認時点: v14.16.x)は
 * この場合entry.targetにchangesから合成したInvite風オブジェクト(.codeを持つ)を積むため、
 * そちらからコードを取得してtargetIdの代わりに使う(discord.js内部の変換結果への依存であり、
 * 将来のバージョンで形が変わる可能性はある。code欠損時は素直にtargetId=nullへフォールバックする)。
 */
function extractInviteTargetId(entry: GuildAuditLogsEntry): string | null {
  if (entry.action !== AuditLogEvent.InviteCreate && entry.action !== AuditLogEvent.InviteDelete) {
    return entry.targetId;
  }
  const target = entry.target as { code?: unknown } | null | undefined;
  return typeof target?.code === "string" && target.code.length > 0 ? target.code : entry.targetId;
}

/**
 * AuditLogEvent(数値enum)を名前文字列へ変換する。未知の値(将来追加分等)は数値文字列にフォールバックする。
 * executorGuildDisplayNameは呼び出し元(registerAuditLogCorrelationHandlers)がguild.members.cacheから
 * 解決したニックネーム優先の表示名。GuildAuditLogsEntry.executor(User)のdisplayNameはグローバル名のみで、
 * ギルドニックネームを持つユーザーの表示が既存のresolveDisplayNames(nick優先)より劣化するため使わない
 * (codexレビュー指摘)。キャッシュにいない場合はundefinedのまま既存のresolveDisplayNamesへフォールバックする。
 */
export function toAuditLogEntryInfo(
  entry: GuildAuditLogsEntry,
  guildId: string,
  executorGuildDisplayName?: string,
): AuditLogEntryInfo {
  return {
    id: entry.id,
    guildId,
    action: AuditLogEvent[entry.action] ?? String(entry.action),
    executorId: entry.executorId,
    executorName: executorGuildDisplayName,
    targetId: extractInviteTargetId(entry),
    createdAt: entry.createdAt.toISOString(),
    roleChanges: extractRoleChanges(entry),
    messageDeleteChannelId: extractMessageDeleteChannelId(entry),
    voiceDisconnectOrMove: extractVoiceDisconnectOrMove(entry),
    memberUpdateVoiceStateChanges: extractMemberUpdateVoiceStateChanges(entry),
  };
}

/**
 * #49〜#51の各イベントハンドラとは異なり、単一のwriteLogEntry呼び出しではなく
 * correlateAuditLogEntry(生ログ保存+既存行への実行者追記)という複合処理のため、
 * writeLogEntrySafelyではなくここで個別にエラーを握りつぶす(discord.jsのリスナーに再配送はない)。
 */
export function registerAuditLogCorrelationHandlers(ctx: FeatureModuleContext, getChannelId: GetChannelId): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx), getChannelId };

  ctx.client.on("guildAuditLogEntryCreate", (entry, guild) => {
    const executorGuildDisplayName = entry.executorId
      ? guild.members.cache.get(entry.executorId)?.displayName
      : undefined;
    void correlateAuditLogEntry(deps, toAuditLogEntryInfo(entry, guild.id, executorGuildDisplayName)).catch(
      (error: unknown) => {
        console.error("Failed to correlate audit log entry", error);
      },
    );
  });
}
