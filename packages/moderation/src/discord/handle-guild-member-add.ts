import type { GuildMember } from "discord.js";
import { ACTION_SEVERITY, type ModerationActionType } from "@management-bot/shared";
import {
  SYSTEM_MODERATOR_ID,
  type EscalationResult,
  type GuildMemberAddDeps,
  handleGuildMemberAdd,
  type RaidHitResult,
} from "../application/index.js";

interface ActionExecutionResult {
  result: "success" | "failed" | "skipped";
  failureCode?: string;
}

const SUCCESS: ActionExecutionResult = { result: "success" };

/** raid/new_account_guardが同一入室者に同時ヒットし、重さ比較でより軽い側が実行されなかったことを表す(#350)。 */
const SKIPPED: ActionExecutionResult = { result: "skipped" };

/** 自動検知によるアクションであることを表すreason(execute-action.tsのSYSTEM_MODERATOR_IDと対になる文言)。 */
function raidTimeoutReason(caseId: string, incidentCount: number): string {
  return `moderation: raid detected (incident #${incidentCount}, case ${caseId})`;
}

function newAccountGuardReason(outcome: EscalationResult): string {
  return `moderation: new_account_guard total strike ${outcome.strikeCount} (case ${outcome.caseId})`;
}

/**
 * レイドヒット時、対象ユーザー全員に一括timeoutを実行する。Discord APIレート制限に
 * 触れやすいため、初期実装は逐次実行から始める(設計spec「リスク・注意点」節、
 * 問題化したらキュー化・バックオフを検討)。個々のtimeout失敗(対象が既に退出した等)は
 * 他の対象への実行を止めないようログのみ行い、結果を返す(#350)。
 */
async function executeRaidTimeout(target: GuildMember, raidHit: RaidHitResult): Promise<ActionExecutionResult> {
  const reason = raidTimeoutReason(raidHit.caseId, raidHit.incidentCount);
  try {
    await target.timeout(raidHit.timeoutMinutes * 60 * 1000, reason);
    return SUCCESS;
  } catch (error) {
    console.error(`moderation: failed to timeout raid target ${target.id} for case ${raidHit.caseId}`, error);
    return { result: "failed", failureCode: "discord_api_error" };
  }
}

/**
 * new_account_guardヒット時、escalateAndRecordStrikeが決定したactionType(warn/timeout、
 * 設計spec「検知時アクション」節)を実行する。既存エスカレーション段階がkick/ban/unbanまで
 * 進んだ場合も同じ仕組みで実行する(#173の共通エスカレーション処理に接続しているため、
 * strikeが積み重なれば通常のエスカレーションと同様に段階が進みうる)。
 */
async function executeNewAccountGuardAction(
  member: GuildMember,
  outcome: EscalationResult,
): Promise<ActionExecutionResult> {
  const reason = newAccountGuardReason(outcome);
  try {
    switch (outcome.actionType) {
      case "warn":
        return SUCCESS;
      case "timeout": {
        const timeoutMinutes = outcome.timeoutMinutes ?? 10;
        await member.timeout(timeoutMinutes * 60 * 1000, reason);
        return SUCCESS;
      }
      case "kick":
        await member.kick(reason);
        return SUCCESS;
      case "ban":
        await member.ban({ reason });
        return SUCCESS;
      case "unban":
        return SUCCESS;
    }
  } catch (error) {
    console.error(`moderation: failed to execute new_account_guard action "${outcome.actionType}" for case ${outcome.caseId}`, error);
    return { result: "failed", failureCode: "discord_api_error" };
  }
}

/** moderation.action.recordedのresolveイベントをpublishする共通ヘルパー(#350)。 */
async function publishResolve(
  deps: GuildMemberAddDeps,
  params: {
    guildId: string;
    caseId: string;
    targetUserId: string;
    actionType: ModerationActionType;
    timeoutMinutes?: number;
    incident: EscalationResult["incident"] | RaidHitResult["incident"];
  },
  execResult: ActionExecutionResult,
): Promise<void> {
  await deps.eventBus.publish({
    type: "moderation.action.recorded",
    guildId: params.guildId,
    caseId: params.caseId,
    targetUserId: params.targetUserId,
    moderatorId: SYSTEM_MODERATOR_ID,
    action: "resolve",
    actionType: params.actionType,
    timeoutMinutes: params.timeoutMinutes,
    incident: params.incident,
    result: execResult.result,
    failureCode: execResult.failureCode,
    createdAt: new Date().toISOString(),
  });
}

/** new_account_guardの処罰実行結果をmoderation.action.recordedのresolveイベントとしてpublishする(#350)。 */
async function executeAndRecordNewAccountGuardAction(
  deps: GuildMemberAddDeps,
  member: GuildMember,
  outcome: EscalationResult,
): Promise<void> {
  const execResult = await executeNewAccountGuardAction(member, outcome);
  await publishResolve(
    deps,
    {
      guildId: member.guild.id,
      caseId: outcome.caseId,
      targetUserId: member.id,
      actionType: outcome.actionType,
      timeoutMinutes: outcome.timeoutMinutes,
      incident: outcome.incident,
    },
    execResult,
  );
}

/** raid一括timeoutの実行結果をmoderation.action.recordedのresolveイベントとしてpublishする(#350)。 */
async function executeAndRecordRaidTimeout(
  deps: GuildMemberAddDeps,
  target: GuildMember,
  raidHit: RaidHitResult,
): Promise<void> {
  const execResult = await executeRaidTimeout(target, raidHit);
  await publishResolve(
    deps,
    {
      guildId: target.guild.id,
      caseId: raidHit.caseId,
      targetUserId: target.id,
      actionType: "timeout",
      timeoutMinutes: raidHit.timeoutMinutes,
      incident: raidHit.incident,
    },
    execResult,
  );
}

/**
 * guildMemberAddイベントを受けてhandleGuildMemberAddを呼び出し、判定結果に応じてDiscord API側の
 * アクション(レイド一括timeout・new_account_guardのwarn/timeout等)を実行する。
 * raid/new_account_guardは互いに独立した判定だが、入室者自身がraidの一括timeout対象と
 * new_account_guardのヒットを同時に満たす場合、両方を順に実行すると後勝ちで上書きされてしまう
 * (例: raidのtimeoutMinutes=1440がnew_account_guardのtimeoutMinutes=5で上書きされる)。
 * そのためactionTypeの重さを比較し、より重い方だけを入室者自身に実行する(Codexレビュー指摘対応)。
 */
export async function handleGuildMemberAddEvent(deps: GuildMemberAddDeps, member: GuildMember): Promise<void> {
  if (member.user.bot) return;

  const result = await handleGuildMemberAdd(deps, {
    guildId: member.guild.id,
    userId: member.id,
    roleIds: [...member.roles.cache.keys()],
    accountCreatedAt: member.user.createdAt,
    joinedAt: member.joinedAt ?? new Date(),
  });

  const raidHit = result.raidHit;
  const guardOutcome = result.newAccountGuardOutcome;
  const selfIsRaidTarget = raidHit !== null && raidHit.targetUserIds.includes(member.id);

  if (selfIsRaidTarget && guardOutcome) {
    // 入室者自身が両方にヒットした場合のみ重さを比較する。raidは常にtimeout。
    // 実行されなかった側のcreateイベント(既にpublish済み)には、未解決のまま残さないよう
    // result="skipped"のresolveをpublishする(#350)。
    if (ACTION_SEVERITY.timeout >= ACTION_SEVERITY[guardOutcome.actionType]) {
      await executeAndRecordRaidTimeout(deps, member, raidHit);
      await publishResolve(
        deps,
        {
          guildId: member.guild.id,
          caseId: guardOutcome.caseId,
          targetUserId: member.id,
          actionType: guardOutcome.actionType,
          timeoutMinutes: guardOutcome.timeoutMinutes,
          incident: guardOutcome.incident,
        },
        SKIPPED,
      );
    } else {
      await executeAndRecordNewAccountGuardAction(deps, member, guardOutcome);
      await publishResolve(
        deps,
        {
          guildId: member.guild.id,
          caseId: raidHit.caseId,
          targetUserId: member.id,
          actionType: "timeout",
          timeoutMinutes: raidHit.timeoutMinutes,
          incident: raidHit.incident,
        },
        SKIPPED,
      );
    }
  } else if (guardOutcome) {
    await executeAndRecordNewAccountGuardAction(deps, member, guardOutcome);
  } else if (selfIsRaidTarget) {
    await executeAndRecordRaidTimeout(deps, member, raidHit);
  }

  if (raidHit) {
    const otherTargetIds = selfIsRaidTarget
      ? raidHit.targetUserIds.filter((id) => id !== member.id)
      : raidHit.targetUserIds;
    for (const targetUserId of otherTargetIds) {
      try {
        const target = await member.guild.members.fetch(targetUserId);
        await executeAndRecordRaidTimeout(deps, target, raidHit);
      } catch (error) {
        console.error(`moderation: failed to fetch raid target ${targetUserId} for case ${raidHit.caseId}`, error);
        await publishResolve(
          deps,
          {
            guildId: member.guild.id,
            caseId: raidHit.caseId,
            targetUserId,
            actionType: "timeout",
            timeoutMinutes: raidHit.timeoutMinutes,
            incident: raidHit.incident,
          },
          { result: "failed", failureCode: "member_not_found" },
        );
      }
    }
  }
}
