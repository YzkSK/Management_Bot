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
 * Bot自身を含むBotの発言も除外する。message出力先チャンネルへの送信(channel.send)自体が
 * 新たなmessageCreateを発火させるため、除外しないとログ送信→記録→ログ送信の無限連鎖になる(codexレビュー指摘)。
 */
function baseFields(message: AnyMessage): { guildId: string; channelId: string; authorId: string } | undefined {
  if (!message.guildId || !message.author || message.author.bot) return undefined;
  return { guildId: message.guildId, channelId: message.channelId, authorId: message.author.id };
}

export function toMessageCreateLogEntry(message: OmitPartialGroupDMChannel<Message>): LogEntry | undefined {
  const base = baseFields(message);
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
export function toMessageUpdateLogEntry(oldMessage: AnyMessage, newMessage: AnyMessage): LogEntry | undefined {
  const base = baseFields(newMessage);
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

export function toMessageDeleteLogEntry(message: AnyMessage): LogEntry | undefined {
  const base = baseFields(message);
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
): LogEntry[] {
  const createdAt = new Date().toISOString();
  const entries: LogEntry[] = [];
  for (const message of messages.values()) {
    const base = baseFields(message);
    if (!base) continue;
    entries.push({ category: "message", ...base, createdAt, action: "bulkDelete", content: message.content || undefined });
  }
  return entries;
}

export function registerMessageHandlers(ctx: FeatureModuleContext): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx) };

  ctx.client.on("messageCreate", (message) => {
    const entry = toMessageCreateLogEntry(message);
    if (entry) writeLogEntrySafely(deps, entry);
  });

  ctx.client.on("messageUpdate", (oldMessage, newMessage) => {
    const entry = toMessageUpdateLogEntry(oldMessage, newMessage);
    if (entry) writeLogEntrySafely(deps, entry);
  });

  ctx.client.on("messageDelete", (message) => {
    const entry = toMessageDeleteLogEntry(message);
    if (entry) writeLogEntrySafely(deps, entry);
  });

  ctx.client.on("messageDeleteBulk", (messages) => {
    for (const entry of toMessageBulkDeleteLogEntries(messages)) {
      writeLogEntrySafely(deps, entry);
    }
  });
}
