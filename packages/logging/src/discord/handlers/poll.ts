import type { FeatureModuleContext } from "@management-bot/core";
import type { Message, OmitPartialGroupDMChannel, PartialMessage } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import type { WriteLogEntryDeps } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";
import { writeLogEntrySafely } from "../write-log-entry-safely.js";

/**
 * discord.jsにpoll開始/終了専用のgatewayイベントがないため、messageCreate/messageUpdateから合成する。
 * #49のhandlers/message.tsとは別ファイルに分離しつつ、同じmessageCreate/messageUpdateイベントに
 * 登録を追加する形になる(いずれもBot自身の発言は対象外。pollを持つ投稿は通常ユーザーのみのため実害は薄いが念のため揃える)。
 */
export function toPollCreateLogEntry(message: OmitPartialGroupDMChannel<Message>): LogEntry | undefined {
  if (!message.guildId || !message.author || message.author.bot || !message.poll) return undefined;
  return {
    category: "poll",
    guildId: message.guildId,
    createdAt: message.createdAt.toISOString(),
    messageId: message.id,
    channelId: message.channelId,
    action: "create",
  };
}

export function toPollEndLogEntry(
  oldMessage: OmitPartialGroupDMChannel<Message | PartialMessage>,
  newMessage: OmitPartialGroupDMChannel<Message | PartialMessage>,
): LogEntry | undefined {
  if (!newMessage.guildId || !newMessage.author || newMessage.author.bot || !newMessage.poll) return undefined;
  // false→trueの遷移のみをendとして記録する。oldMessage.pollが未キャッシュ(undefined)等で前状態不明な場合は
  // 遷移を確認できないため記録しない(codexレビュー指摘: 誤ってendを捏造するバグの修正)。
  if (oldMessage.poll?.resultsFinalized !== false || newMessage.poll.resultsFinalized !== true) return undefined;
  return {
    category: "poll",
    guildId: newMessage.guildId,
    createdAt: new Date().toISOString(),
    messageId: newMessage.id,
    channelId: newMessage.channelId,
    action: "end",
  };
}

export function registerPollHandlers(ctx: FeatureModuleContext): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx) };

  ctx.client.on("messageCreate", (message) => {
    const entry = toPollCreateLogEntry(message);
    if (entry) writeLogEntrySafely(deps, entry);
  });
  ctx.client.on("messageUpdate", (oldMessage, newMessage) => {
    const entry = toPollEndLogEntry(oldMessage, newMessage);
    if (entry) writeLogEntrySafely(deps, entry);
  });
}
