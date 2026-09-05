import type { FeatureModuleContext } from "@management-bot/core";
import type { Message, OmitPartialGroupDMChannel, PartialMessage, ReadonlyCollection, Snowflake } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import type { WriteLogEntryDeps } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";
import { writeLogEntrySafely } from "../write-log-entry-safely.js";

type AnyMessage = OmitPartialGroupDMChannel<Message | PartialMessage>;

/**
 * DMメッセージ(guildIdなし)・author未解決のpartial messageは
 * 必須フィールドを埋められないためログ化をスキップする(ベストエフォート)。
 * Bot自身(botUserId)の発言のみ除外する。message出力先チャンネルへの送信(channel.send)自体が
 * 新たなmessageCreateを発火させるため、除外しないとログ送信→記録→ログ送信の無限連鎖になる(codexレビュー指摘)。
 * 他Botの発言はモデレーション上有用なため、自Bot以外は除外しない(全Bot除外は過剰な仕様だったため縮小)。
 *
 * botUserId未確定(ctx.client.userがまだ設定されていない、readyイベント前)の場合は
 * フィルタが機能せず自Bot発言を素通しして無限連鎖を招き得るため、fail-closed(何も記録しない)にする。
 * fail-open(botUserId===undefinedを「誰とも一致しない」として扱う)にすると
 * 自Bot判定が常にfalseになり無限連鎖防止という本来の目的が壊れるため避ける(セキュリティレビュー指摘)。
 */
/**
 * excludeBotAuthor: pinログは「投稿の作成」ではなく「ピン状態の変更」を記録するものであり、
 * ログ送信メッセージがピン留めされて無限連鎖する経路もないため、自Bot投稿の除外は不要
 * (むしろBotの告知等を管理者がピン留めした操作を記録できなくなってしまう、codexレビュー指摘)。
 */
function baseFields(
  message: AnyMessage,
  botUserId: string | undefined,
  excludeBotAuthor = true,
): { guildId: string; channelId: string; authorId: string } | undefined {
  if (!message.guildId || !message.author) return undefined;
  if (excludeBotAuthor && (!botUserId || message.author.id === botUserId)) return undefined;
  return { guildId: message.guildId, channelId: message.channelId, authorId: message.author.id };
}

export function toMessageCreateLogEntry(
  message: OmitPartialGroupDMChannel<Message>,
  botUserId: string | undefined,
): LogEntry | undefined {
  const base = baseFields(message, botUserId);
  if (!base) return undefined;
  return {
    category: "message",
    ...base,
    createdAt: message.createdAt.toISOString(),
    action: "create",
    content: message.content || undefined,
  };
}

/**
 * 本文が変化しないmessageUpdate(ピン留め・embed生成等)はログ対象外にする。
 * oldMessageがpartial(contentが未取得でnull)の場合、実際は本文が変わっていなくても
 * content比較が常に不一致になり誤ったupdateログを生成するため、比較前にスキップする。
 */
export function toMessageUpdateLogEntry(
  oldMessage: AnyMessage,
  newMessage: AnyMessage,
  botUserId: string | undefined,
): LogEntry | undefined {
  const base = baseFields(newMessage, botUserId);
  if (!base) return undefined;
  if (oldMessage.partial) return undefined;
  if (oldMessage.content === newMessage.content) return undefined;
  return {
    category: "message",
    ...base,
    createdAt: new Date().toISOString(),
    action: "update",
    content: newMessage.content || undefined,
    previousContent: oldMessage.content,
  };
}

/**
 * discord.jsにピン留め専用のgatewayイベント(channelPinsUpdate)は対象メッセージを含まないため、
 * pinned真偽値の変化を持つmessageUpdateから合成する。oldMessage.pinnedがpartialで未取得
 * (undefined)の場合は変化を判定できないためスキップする。
 */
export function toMessagePinLogEntry(
  oldMessage: AnyMessage,
  newMessage: AnyMessage,
  botUserId: string | undefined,
): LogEntry | undefined {
  const base = baseFields(newMessage, botUserId, false);
  if (!base) return undefined;
  if (oldMessage.partial || oldMessage.pinned === newMessage.pinned) return undefined;
  return {
    category: "message",
    ...base,
    messageId: newMessage.id,
    createdAt: new Date().toISOString(),
    action: newMessage.pinned ? "pin" : "unpin",
  };
}

export function toMessageDeleteLogEntry(message: AnyMessage, botUserId: string | undefined): LogEntry | undefined {
  const base = baseFields(message, botUserId);
  if (!base) return undefined;
  return {
    category: "message",
    ...base,
    createdAt: new Date().toISOString(),
    action: "delete",
    content: message.content || undefined,
  };
}

export function toMessageBulkDeleteLogEntries(
  messages: ReadonlyCollection<Snowflake, Message<true> | PartialMessage<true>>,
  botUserId: string | undefined,
): LogEntry[] {
  const createdAt = new Date().toISOString();
  const entries: LogEntry[] = [];
  for (const message of messages.values()) {
    const base = baseFields(message, botUserId);
    if (!base) continue;
    entries.push({ category: "message", ...base, createdAt, action: "bulkDelete", content: message.content || undefined });
  }
  return entries;
}

export function registerMessageHandlers(ctx: FeatureModuleContext): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx) };

  ctx.client.on("messageCreate", (message) => {
    const entry = toMessageCreateLogEntry(message, ctx.client.user?.id);
    if (entry) writeLogEntrySafely(deps, entry);
  });

  ctx.client.on("messageUpdate", (oldMessage, newMessage) => {
    const entry = toMessageUpdateLogEntry(oldMessage, newMessage, ctx.client.user?.id);
    if (entry) writeLogEntrySafely(deps, entry);

    const pinEntry = toMessagePinLogEntry(oldMessage, newMessage, ctx.client.user?.id);
    if (pinEntry) writeLogEntrySafely(deps, pinEntry);
  });

  ctx.client.on("messageDelete", (message) => {
    const entry = toMessageDeleteLogEntry(message, ctx.client.user?.id);
    if (entry) writeLogEntrySafely(deps, entry);
  });

  ctx.client.on("messageDeleteBulk", (messages) => {
    for (const entry of toMessageBulkDeleteLogEntries(messages, ctx.client.user?.id)) {
      writeLogEntrySafely(deps, entry);
    }
  });
}
