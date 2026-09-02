import type { FeatureModuleContext } from "@management-bot/core";
import type { Message, OmitPartialGroupDMChannel, PartialMessage } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import type { PendingPoll, WriteLogEntryDeps } from "../../application/index.js";
import { findPendingPolls, writeLogEntry } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";
import { writeLogEntrySafely } from "../write-log-entry-safely.js";

/**
 * discord.jsにpoll開始/終了専用のgatewayイベントがないため、messageCreate/messageUpdateから合成する。
 * #49のhandlers/message.tsとは別ファイルに分離しつつ、同じmessageCreate/messageUpdateイベントに
 * 登録を追加する形になる。writeLogEntryが送るログメッセージにpollは含まれないため
 * (formatLogEntryはテキストのみ生成)、message.tsのような自Bot除外(無限連鎖対策)は不要。
 * Botが作成したpoll(APIでは作成可能)も除外せず記録する。
 */
export function toPollCreateLogEntry(message: OmitPartialGroupDMChannel<Message>): LogEntry | undefined {
  if (!message.guildId || !message.author || !message.poll) return undefined;
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
  if (!newMessage.guildId || !newMessage.author || !newMessage.poll) return undefined;
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

/**
 * findPendingPollsが返したcreate済み・end未記録のpoll候補について、実際にメッセージを取得し
 * resultsFinalizedを確認する(取得できて確定していればendを記録する)。チャンネル/メッセージが
 * 既に削除されている等で取得できない場合は諦める(次回起動時、遡及期間内なら再度候補に上がる)。
 */
async function reconcilePendingPoll(ctx: FeatureModuleContext, deps: WriteLogEntryDeps, pending: PendingPoll): Promise<void> {
  const channel = await ctx.client.channels.fetch(pending.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(pending.messageId).catch(() => null);
  if (!message?.poll?.resultsFinalized) return;

  await writeLogEntry(
    deps,
    {
      category: "poll",
      guildId: pending.guildId,
      createdAt: new Date().toISOString(),
      messageId: pending.messageId,
      channelId: pending.channelId,
      action: "end",
    },
    `poll:end:${pending.messageId}`,
  );
}

/**
 * Botダウン中に締め切られたpollのend記録漏れ(#49〜#51はゲートウェイイベント駆動のためオフライン中は検知不能)を
 * 起動時(readyイベント)に1回だけ再照合する。詳細はfindPendingPolls参照。
 */
function registerPollReconciliation(ctx: FeatureModuleContext, deps: WriteLogEntryDeps): void {
  ctx.client.once("ready", () => {
    void findPendingPolls(ctx.db)
      .then((pending) =>
        Promise.all(
          pending.map((poll) =>
            reconcilePendingPoll(ctx, deps, poll).catch((error: unknown) => {
              console.error(`Failed to reconcile pending poll ${poll.messageId}`, error);
            }),
          ),
        ),
      )
      .catch((error: unknown) => {
        console.error("Failed to query pending polls", error);
      });
  });
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
  registerPollReconciliation(ctx, deps);
}
