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
 * 実行対象(mostSevereで選ばれた1件)のbufferedMessageIdsに、他のviolationType(例:
 * flood=timeout・duplicate_content=messageDeleteが同時ヒットした場合のduplicate_content側)の
 * bufferedMessageIdsもマージする。より重いアクションに集約されて実行されない側のoutcomeでも
 * 削除対象だったメッセージは削除する(処罰の集約によって削除だけが漏れることを防ぐ)。
 */
function mergeBufferedMessageIds(outcomes: readonly EscalationOutcome[]): readonly string[] {
  const ids = new Set<string>();
  for (const outcome of outcomes) {
    for (const id of outcome.bufferedMessageIds) ids.add(id);
  }
  return [...ids];
}

/**
 * messageCreateイベントを受けてdetectAndEscalateを呼び出し、判定結果に応じてDiscord API側の
 * アクションを実行する。flood/duplicate_contentが同一メッセージで同時にヒットした場合、
 * moderation.action.recordedはviolationTypeごとに独立してpublishされるが、
 * Discord側への処罰(timeout/kick/ban)実行は最も重いもの1件に集約する(同一メッセージへの
 * 二重実行を避ける)。メッセージ削除は集約対象と関係なく、ヒットした全violationTypeの
 * bufferedMessageIdsをマージして実行する(処罰の集約によって削除だけが漏れることを防ぐ)。
 */
export async function handleMessageCreate(deps: DetectAndEscalateDeps, message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guild || !message.member) return;

  const outcomes = await detectAndEscalate(deps, {
    guildId: message.guild.id,
    userId: message.author.id,
    channelId: message.channelId,
    roleIds: [...message.member.roles.cache.keys()],
    messageId: message.id,
    content: message.content,
    createdAt: message.createdAt,
  });

  if (outcomes.length === 0) return;

  const target = mostSevere(outcomes);
  await executeEscalationAction(message, { ...target, bufferedMessageIds: mergeBufferedMessageIds(outcomes) });
}
