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
 */
function baseFields(
  message: AnyMessage,
  botUserId: string | undefined,
): { guildId: string; channelId: string; authorId: string } | undefined {
  if (!message.guildId || !message.author || message.author.id === botUserId) return undefined;
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

/** 本文が変化しないmessageUpdate(ピン留め・embed生成等)はログ対象外にする。 */
export function toMessageUpdateLogEntry(
  oldMessage: AnyMessage,
  newMessage: AnyMessage,
  botUserId: string | undefined,
): LogEntry | undefined {
  const base = baseFields(newMessage, botUserId);
  if (!base) return undefined;
  if (oldMessage.content === newMessage.content) return undefined;
  return {
    category: "message",
    ...base,
    createdAt: new Date().toISOString(),
    action: "update",
    content: newMessage.content || undefined,
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
