import type { Message } from "discord.js";
import { SYSTEM_MODERATOR_ID, detectAndEscalateOnEdit, type DetectAndEscalateDeps } from "../application/index.js";
import { deleteBufferedMessages, executeEscalationAction } from "./execute-action.js";

/**
 * messageUpdateイベントを受けて、編集後の内容でngword/invite_linkのみ再検知する(改善案7.1節)。
 * 投稿時は無害だったメッセージに、編集でNGワード・招待リンクを後から仕込む回避を防ぐ。
 * flood/duplicate_content/mention_spamは対象外(detectAndEscalateOnEditのコメント参照)。
 * 複数violationTypeが同時ヒットする可能性はhandleMessageCreateと同様だが、対象が
 * ngword/invite_linkの2種のみのため、集約(mostSevere)せず両方とも独立して処罰を実行する
 * (同一メッセージへの二重削除は起き得るが、deleteBufferedMessagesは冪等な操作のため実害はない)。
 */
export async function handleMessageUpdate(deps: DetectAndEscalateDeps, message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guild || !message.member) return;

  const { outcomes, lockedMessageIds } = await detectAndEscalateOnEdit(deps, {
    guildId: message.guild.id,
    userId: message.author.id,
    channelId: message.channelId,
    roleIds: [...message.member.roles.cache.keys()],
    messageId: message.id,
    content: message.content,
    createdAt: message.createdAt,
  });

  if (outcomes.length === 0) {
    if (lockedMessageIds.length > 0) {
      try {
        await deleteBufferedMessages(message, lockedMessageIds);
      } catch (error) {
        console.error("moderation: failed to delete locked messages (edit)", error);
      }
    }
    return;
  }

  for (const outcome of outcomes) {
    const execResult = await executeEscalationAction(message, outcome);
    await deps.eventBus.publish({
      type: "moderation.action.recorded",
      guildId: message.guild.id,
      caseId: outcome.caseId,
      targetUserId: message.author.id,
      moderatorId: SYSTEM_MODERATOR_ID,
      action: "resolve",
      actionType: outcome.actionType,
      timeoutMinutes: outcome.timeoutMinutes,
      result: execResult.result,
      failureCode: execResult.failureCode,
      createdAt: new Date().toISOString(),
    });
  }
}
