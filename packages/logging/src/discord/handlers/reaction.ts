import type { FeatureModuleContext } from "@management-bot/core";
import type { MessageReaction, PartialMessageReaction, PartialUser, User } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import type { WriteLogEntryDeps } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";
import { writeLogEntrySafely } from "../write-log-entry-safely.js";

type ReactionAction = Extract<LogEntry, { category: "reaction" }>["action"];

/**
 * reactionがpartial(未キャッシュ)でもmessage.guildId等の必須フィールドはBotClientの
 * partials設定(Partials.Reaction/Message)により利用できるため、そこはガードのみで足りる。
 * userがpartialでもuser.idはDiscordから常に取得できるため、partialを理由にスキップしない
 * (以前はuser.partialでスキップしており、キャッシュ切れユーザーのログが欠落する原因だった)。
 * Bot自身のリアクションは記録対象から除外しない(他カテゴリと異なりBotの反応自体が
 * モデレーション上有用、かつリアクションはchannel.sendを発火させないため無限連鎖の懸念もない)。
 */
function toReactionLogEntry(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  action: ReactionAction,
): LogEntry | undefined {
  const { message } = reaction;
  if (!message.guildId) return undefined;
  return {
    category: "reaction",
    guildId: message.guildId,
    createdAt: new Date().toISOString(),
    channelId: message.channelId,
    messageId: message.id,
    userId: user.id,
    emoji: reaction.emoji.toString(),
    action,
    actorIsBot: user.bot,
  };
}

export function toReactionAddLogEntry(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): LogEntry | undefined {
  return toReactionLogEntry(reaction, user, "add");
}

export function toReactionRemoveLogEntry(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): LogEntry | undefined {
  return toReactionLogEntry(reaction, user, "remove");
}

export function registerReactionHandlers(ctx: FeatureModuleContext): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx) };

  ctx.client.on("messageReactionAdd", (reaction, user) => {
    const entry = toReactionAddLogEntry(reaction, user);
    if (entry) writeLogEntrySafely(deps, entry);
  });
  ctx.client.on("messageReactionRemove", (reaction, user) => {
    const entry = toReactionRemoveLogEntry(reaction, user);
    if (entry) writeLogEntrySafely(deps, entry);
  });
}
