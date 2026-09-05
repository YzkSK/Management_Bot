import type { FeatureModuleContext } from "@management-bot/core";
import type { MessageReaction, PartialMessageReaction, PartialUser, User } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import type { WriteLogEntryDeps } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";
import { writeLogEntrySafely } from "../write-log-entry-safely.js";

type ReactionAction = Extract<LogEntry, { category: "reaction" }>["action"];

/**
 * reaction/userがpartial(未キャッシュ、fetchPartials未設定時)の場合、message.guildId等の
 * 必須フィールドを埋められないことがあるためログ化をスキップする(message.tsの方針を踏襲)。
 * Bot自身のリアクションは記録対象から除外しない(他カテゴリと異なりBotの反応自体が
 * モデレーション上有用、かつリアクションはchannel.sendを発火させないため無限連鎖の懸念もない)。
 */
function toReactionLogEntry(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  action: ReactionAction,
): LogEntry | undefined {
  const { message } = reaction;
  if (!message.guildId || user.partial) return undefined;
  return {
    category: "reaction",
    guildId: message.guildId,
    createdAt: new Date().toISOString(),
    channelId: message.channelId,
    messageId: message.id,
    userId: user.id,
    emoji: reaction.emoji.toString(),
    action,
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
