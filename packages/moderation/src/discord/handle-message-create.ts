import type { Message } from "discord.js";
import type { ModerationActionType } from "@management-bot/shared";
import { detectAndEscalate, type DetectAndEscalateDeps, type EscalationOutcome } from "../application/index.js";
import { executeEscalationAction } from "./execute-action.js";

const ACTION_SEVERITY: Record<ModerationActionType, number> = {
  warn: 0,
  messageDelete: 1,
  timeout: 2,
  kick: 3,
  ban: 4,
  unban: -1,
};

function mostSevere(outcomes: readonly EscalationOutcome[]): EscalationOutcome {
  return outcomes.reduce((most, outcome) =>
    ACTION_SEVERITY[outcome.actionType] > ACTION_SEVERITY[most.actionType] ? outcome : most,
  );
}

/**
 * messageCreateイベントを受けてdetectAndEscalateを呼び出し、判定結果に応じてDiscord API側の
 * アクションを実行する。flood/duplicate_contentが同一メッセージで同時にヒットした場合、
 * moderation.action.recordedはviolationTypeごとに独立してpublishされるが、
 * Discord側への実際の処罰実行は最も重いもの1件に集約する(同一メッセージへの二重実行を避ける)。
 */
export async function handleMessageCreate(deps: DetectAndEscalateDeps, message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guild || !message.member) return;

  const outcomes = await detectAndEscalate(deps, {
    guildId: message.guild.id,
    userId: message.author.id,
    roleIds: [...message.member.roles.cache.keys()],
    messageId: message.id,
    content: message.content,
    createdAt: message.createdAt,
  });

  if (outcomes.length === 0) return;

  await executeEscalationAction(message, mostSevere(outcomes));
}
