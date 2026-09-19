import type { FeatureModuleContext } from "@management-bot/core";
import { findModerationCaseIdForDeletedMessages } from "@management-bot/db";
import type { Message, OmitPartialGroupDMChannel, PartialMessage, ReadonlyCollection, Snowflake } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import { type GetChannelId, type WriteLogEntryDeps } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";
import { writeLogEntrySafely } from "../write-log-entry-safely.js";

type AnyMessage = OmitPartialGroupDMChannel<Message | PartialMessage>;
type MessageAttachments = { url: string; filename: string; contentType?: string }[] | undefined;
type BulkDeleteMessageLogEntry = LogEntry & {
  category: "message";
  action: "bulkDelete";
  moderationCaseId?: string;
  deletedMessages: {
    messageId: string;
    authorId: string;
    authorName: string;
    content?: string;
    attachments?: MessageAttachments;
  }[];
};

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
/**
 * フォーラム/メディアチャンネルの新規投稿はスレッド自体がスターターメッセージを兼ね、
 * そのメッセージIDはスレッドID(channelId)と一致する。既存チャンネルのメッセージを元に
 * 作成したスレッドの最初のメッセージは元のメッセージIDのままなので一致しない。
 */
function isThreadStarterMessage(message: AnyMessage): boolean {
  return message.id === message.channelId;
}

/** 添付ファイルの実体は保存せずDiscord CDNのURL・ファイル名・content typeのみ抽出する(ストレージ節約)。 */
function toAttachments(message: AnyMessage): MessageAttachments {
  if (message.attachments.size === 0) return undefined;
  return message.attachments.map((attachment) => ({
    url: attachment.url,
    filename: attachment.name,
    contentType: attachment.contentType ?? undefined,
  }));
}

function baseFields(
  message: AnyMessage,
  botUserId: string | undefined,
  excludeBotAuthor = true,
): { guildId: string; channelId: string; authorId: string; authorName: string; actorIsBot: boolean } | undefined {
  if (!message.guildId || !message.author) return undefined;
  if (excludeBotAuthor && (!botUserId || message.author.id === botUserId)) return undefined;
  return {
    guildId: message.guildId,
    channelId: message.channelId,
    authorId: message.author.id,
    // message.memberはキャッシュ済みの場合のみニックネームを反映する(未キャッシュ時はUser.displayNameへフォールバック)。
    authorName: message.member?.displayName ?? message.author.displayName,
    actorIsBot: message.author.bot,
  };
}

export function toMessageCreateLogEntry(
  message: OmitPartialGroupDMChannel<Message>,
  botUserId: string | undefined,
): LogEntry | undefined {
  // Discordが自動生成するシステムメッセージ(ThreadCreated/ピン通知/参加通知/Boost等)は
  // ユーザーによる投稿ではないため対象外にする。ThreadCreatedはthreadCreateログと重複し、
  // ピン通知はtoMessagePinLogEntryで別途action:"pin"として記録される。
  if (message.system) return undefined;
  // スレッドのスターターメッセージ(フォーラム/メディア投稿)はthreadCreateログと重複するため対象外。
  if (isThreadStarterMessage(message)) return undefined;
  const base = baseFields(message, botUserId);
  if (!base) return undefined;
  return {
    category: "message",
    ...base,
    messageId: message.id,
    createdAt: message.createdAt.toISOString(),
    action: "create",
    content: message.content || undefined,
    attachments: toAttachments(message),
  };
}

/**
 * 本文・添付ファイルが両方とも変化しないmessageUpdate(ピン留め・embed生成等)はログ対象外にする。
 * 添付のみの追加・削除(本文は同一)もログ対象に含めるため、contentだけでなくattachmentsも比較する。
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
  const contentChanged = oldMessage.content !== newMessage.content;
  const attachmentsChanged = JSON.stringify(toAttachments(oldMessage)) !== JSON.stringify(toAttachments(newMessage));
  if (!contentChanged && !attachmentsChanged) return undefined;
  return {
    category: "message",
    ...base,
    createdAt: new Date().toISOString(),
    action: "update",
    content: newMessage.content || undefined,
    previousContent: oldMessage.content,
    attachments: toAttachments(newMessage),
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
    attachments: toAttachments(message),
  };
}

export function toMessageBulkDeleteLogEntry(
  messages: ReadonlyCollection<Snowflake, Message<true> | PartialMessage<true>>,
  botUserId: string | undefined,
  moderationCaseId?: string,
): BulkDeleteMessageLogEntry | undefined {
  const createdAt = new Date().toISOString();
  let aggregateFields: { guildId: string; channelId: string } | undefined;
  const deletedMessages: {
    messageId: string;
    authorId: string;
    authorName: string;
    content?: string;
    attachments?: MessageAttachments;
  }[] = [];
  for (const message of messages.values()) {
    const fields = baseFields(message, botUserId);
    if (!fields) continue;
    aggregateFields ??= { guildId: fields.guildId, channelId: fields.channelId };
    deletedMessages.push({
      messageId: message.id,
      authorId: fields.authorId,
      authorName: fields.authorName,
      content: message.content || undefined,
      attachments: toAttachments(message),
    });
  }
  if (!aggregateFields || deletedMessages.length === 0) return undefined;
  return {
    category: "message",
    ...aggregateFields,
    createdAt,
    action: "bulkDelete",
    ...(moderationCaseId ? { moderationCaseId } : {}),
    deletedMessages,
  };
}

async function writeMessageBulkDeleteLogEntry(
  ctx: FeatureModuleContext,
  deps: WriteLogEntryDeps,
  messages: ReadonlyCollection<Snowflake, Message<true> | PartialMessage<true>>,
): Promise<void> {
  const entry = toMessageBulkDeleteLogEntry(messages, ctx.client.user?.id);
  if (!entry) return;

  try {
    const moderationCaseId = await findModerationCaseIdForDeletedMessages(
      ctx.db,
      entry.guildId,
      entry.deletedMessages.map((message) => message.messageId),
    );
    writeLogEntrySafely(deps, moderationCaseId ? { ...entry, moderationCaseId } : entry);
  } catch (error) {
    // ログ連携失敗でDiscordのイベント処理を止めず、因果関係なしの通常一括削除ログとして残す。
    console.error("logging: failed to resolve moderation case for bulk deletion", error);
    writeLogEntrySafely(deps, entry);
  }
}

export function registerMessageHandlers(ctx: FeatureModuleContext, getChannelId: GetChannelId): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx), getChannelId };

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
    void writeMessageBulkDeleteLogEntry(ctx, deps, messages);
  });
}
