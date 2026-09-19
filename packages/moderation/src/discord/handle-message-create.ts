import type { Message } from "discord.js";
import { ACTION_SEVERITY } from "@management-bot/shared";
import {
  detectAndEscalate,
  SYSTEM_MODERATOR_ID,
  type DetectAndEscalateDeps,
  type EscalationOutcome,
} from "../application/index.js";
import { deleteBufferedMessages, executeEscalationAction } from "./execute-action.js";

function mostSevere(outcomes: readonly EscalationOutcome[]): EscalationOutcome {
  return outcomes.reduce((most, outcome) =>
    ACTION_SEVERITY[outcome.actionType] > ACTION_SEVERITY[most.actionType] ? outcome : most,
  );
}

/**
 * 実行対象(mostSevereで選ばれた1件)のbufferedMessageIdsに、他のviolationType(例:
 * flood=timeout・duplicate_content=warnが同時ヒットした場合のduplicate_content側)の
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
 *
 * Bot・Webhook投稿も検知対象に含める(改善案7.2節)。自Bot自身の投稿のみ除外し、他Bot・
 * 侵害されたWebhookの投稿は通常のユーザー投稿と同様にホワイトリスト判定・違反検知にかける
 * (信頼できるBotは既存のホワイトリスト機構でtargetType="user"にそのBotのユーザーIDを
 * 登録することで除外できる)。WebhookメッセージはGuildMemberを持たない(message.memberが
 * null)ため、ロール判定は空配列で行い、timeout/kick/banはexecuteEscalationActionの
 * 既存のmember_not_foundフォールバックにより自動的に失敗扱いになる(削除は実行される)。
 */
export async function handleMessageCreate(deps: DetectAndEscalateDeps, message: Message): Promise<void> {
  // client.userが未確定(ログイン処理中等)の場合、自Bot判定が常にfalseになり自Bot自身の
  // 投稿まで検知対象に含まれてしまう(fail-open)。安全側に倒し、確定するまで何もしない
  // (Codexレビュー指摘)。
  const selfBotId = message.client.user?.id;
  if (!selfBotId || message.author.id === selfBotId) return;
  if (!message.guild) return;

  const { outcomes, lockedMessageIds } = await detectAndEscalate(deps, {
    guildId: message.guild.id,
    userId: message.author.id,
    channelId: message.channelId,
    roleIds: message.member ? [...message.member.roles.cache.keys()] : [],
    messageId: message.id,
    content: message.content,
    createdAt: message.createdAt,
    joinedAt: message.member?.joinedAt ?? undefined,
  });

  if (outcomes.length === 0) {
    // strikeロック中でも検知されたメッセージ(ngword/mention_spam/invite_link)は
    // strike加算・エスカレーション通知なしで削除のみ行う(#338)。
    if (lockedMessageIds.length > 0) {
      try {
        await deleteBufferedMessages(message, lockedMessageIds);
      } catch (error) {
        console.error("moderation: failed to delete locked messages", error);
      }
    }
    return;
  }

  const target = mostSevere(outcomes);
  const execResult = await executeEscalationAction(message, {
    ...target,
    bufferedMessageIds: mergeBufferedMessageIds(outcomes),
  });
  await deps.eventBus.publish({
    type: "moderation.action.recorded",
    guildId: message.guild.id,
    caseId: target.caseId,
    targetUserId: message.author.id,
    moderatorId: SYSTEM_MODERATOR_ID,
    action: "resolve",
    actionType: target.actionType,
    timeoutMinutes: target.timeoutMinutes,
    result: execResult.result,
    failureCode: execResult.failureCode,
    createdAt: new Date().toISOString(),
  });

  // targetに集約されず実行されなかった側のcreateイベント(既にpublish済み)にも、
  // 未解決のまま残さないようresult="skipped"のresolveをpublishする(#350、codexレビュー指摘)。
  for (const outcome of outcomes) {
    if (outcome.caseId === target.caseId) continue;
    await deps.eventBus.publish({
      type: "moderation.action.recorded",
      guildId: message.guild.id,
      caseId: outcome.caseId,
      targetUserId: message.author.id,
      moderatorId: SYSTEM_MODERATOR_ID,
      action: "resolve",
      actionType: outcome.actionType,
      timeoutMinutes: outcome.timeoutMinutes,
      result: "skipped",
      createdAt: new Date().toISOString(),
    });
  }
}
