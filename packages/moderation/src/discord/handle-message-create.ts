import type { Message } from "discord.js";
import { recordModerationMessageDeletionLinks } from "@management-bot/db";
import { ACTION_SEVERITY } from "@management-bot/shared";
import {
  detectAndEscalate,
  SYSTEM_MODERATOR_ID,
  type DetectAndEscalateDeps,
  type EscalationOutcome,
} from "../application/index.js";
import { BurstSettlementCoordinator } from "./burst-settlement.js";
import { deleteBufferedMessages, executeEscalationAction } from "./execute-action.js";

export interface HandleMessageCreateDeps extends DetectAndEscalateDeps {
  burstSettlementCoordinator: BurstSettlementCoordinator;
}

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

function burstKey(message: Message): string {
  return `${message.guild!.id}:${message.channelId}:${message.author.id}`;
}

function settlementMessageThreshold(outcomes: readonly EscalationOutcome[]): number | undefined {
  const thresholds = outcomes.flatMap((outcome) =>
    outcome.settlementMessageThreshold === undefined ? [] : [outcome.settlementMessageThreshold],
  );
  return thresholds.length === 0 ? undefined : Math.min(...thresholds);
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
export async function handleMessageCreate(deps: HandleMessageCreateDeps, message: Message): Promise<void> {
  // client.userが未確定(ログイン処理中等)の場合、自Bot判定が常にfalseになり自Bot自身の
  // 投稿まで検知対象に含まれてしまう(fail-open)。安全側に倒し、確定するまで何もしない
  // (Codexレビュー指摘)。
  const selfBotId = message.client.user?.id;
  if (!selfBotId || message.author.id === selfBotId) return;
  if (!message.guild) return;

  const key = burstKey(message);
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

  const appendedToSettlingBurst =
    outcomes.length === 0 && lockedMessageIds.length === 0 && deps.burstSettlementCoordinator.append(key, message.id);

  if (outcomes.length === 0) {
    // strikeロック中でも検知されたメッセージ(ngword/mention_spam/invite_link)は
    // strike加算・エスカレーション通知なしで削除のみ行う(#338)。
    if (lockedMessageIds.length > 0) {
      try {
        await deleteBufferedMessages(message, lockedMessageIds);
      } catch (error) {
        console.error("moderation: failed to delete locked messages", error);
      }
    } else if (!appendedToSettlingBurst && deps.burstSettlementCoordinator.consumePostLimitDrain(key)) {
      // 収束待ちが上限に達した後も連投が続く場合、strike lockのため次のoutcomeにはならない。
      // 1秒の無投稿期間までこの経路で削除し、削除漏れを防ぐ。
      try {
        await deleteBufferedMessages(message, [message.id]);
      } catch (error) {
        console.error("moderation: failed to delete post-limit messages", error);
      }
    }
    return;
  }

  const target = mostSevere(outcomes);
  const threshold = settlementMessageThreshold(outcomes);
  const bufferedMessageIds =
    threshold === undefined
      ? mergeBufferedMessageIds(outcomes)
      : (
          await deps.burstSettlementCoordinator.start({
            key,
            initialMessageIds: mergeBufferedMessageIds(outcomes),
            maxAdditionalMessages: threshold,
          })
        ).messageIds;
  // DiscordのmessageDeleteBulkイベントはbulkDelete()の実行中にも届きうるため、先に永続化する。
  // 関連付けが書き込めなければアクションを実行せず、因果関係が欠けたログを作らない。
  if (bufferedMessageIds.length >= 2 && "bulkDelete" in message.channel) {
    await recordModerationMessageDeletionLinks(deps.db, {
      guildId: message.guild.id,
      caseId: target.caseId,
      messageIds: bufferedMessageIds,
    });
  }
  const execResult = await executeEscalationAction(message, {
    ...target,
    bufferedMessageIds,
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
    incident: target.incident,
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
      incident: outcome.incident,
      result: "skipped",
      createdAt: new Date().toISOString(),
    });
  }
}
