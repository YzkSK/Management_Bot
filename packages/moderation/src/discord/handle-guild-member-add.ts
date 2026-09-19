import type { GuildMember } from "discord.js";
import { type ModerationActionType } from "@management-bot/shared";
import {
  SYSTEM_MODERATOR_ID,
  getLockdownSettings,
  setLockdownRequested,
  type GuildMemberAddDeps,
  handleGuildMemberAdd,
  type RaidHitResult,
} from "../application/index.js";
import { synchronizeLockdown } from "./lockdown.js";

interface ActionExecutionResult {
  result: "success" | "failed" | "skipped";
  failureCode?: string;
}

const SUCCESS: ActionExecutionResult = { result: "success" };

async function sendRaidKickDm(member: GuildMember): Promise<void> {
  await member.user
    .send("レイド対策のため、一時的にサーバーから退出させました。誤判定の場合はサーバー管理者へ連絡してください。")
    .catch((error) => console.error(`moderation: failed to send raid kick DM to ${member.id}`, error));
}

/** raid/new_account_guardが同一入室者に同時ヒットし、重さ比較でより軽い側が実行されなかったことを表す(#350)。 */
/** 自動検知によるアクションであることを表すreason(execute-action.tsのSYSTEM_MODERATOR_IDと対になる文言)。 */
function raidKickReason(caseId: string, incidentCount: number): string {
  return `moderation: raid detected (incident #${incidentCount}, case ${caseId})`;
}

/**
 * レイドヒット時、対象ユーザー全員に一括timeoutを実行する。Discord APIレート制限に
 * 触れやすいため、初期実装は逐次実行から始める(設計spec「リスク・注意点」節、
 * 問題化したらキュー化・バックオフを検討)。個々のtimeout失敗(対象が既に退出した等)は
 * 他の対象への実行を止めないようログのみ行い、結果を返す(#350)。
 */
async function executeRaidKick(target: GuildMember, raidHit: RaidHitResult): Promise<ActionExecutionResult> {
  const reason = raidKickReason(raidHit.caseId, raidHit.incidentCount);
  try {
    await target.kick(reason);
    await sendRaidKickDm(target);
    return SUCCESS;
  } catch (error) {
    console.error(`moderation: failed to kick raid target ${target.id} for case ${raidHit.caseId}`, error);
    return { result: "failed", failureCode: "discord_api_error" };
  }
}

/**
 * new_account_guardヒット時、escalateAndRecordStrikeが決定したactionType(warn/timeout、
 * 設計spec「検知時アクション」節)を実行する。既存エスカレーション段階がkick/ban/unbanまで
 * 進んだ場合も同じ仕組みで実行する(#173の共通エスカレーション処理に接続しているため、
 * strikeが積み重なれば通常のエスカレーションと同様に段階が進みうる)。
 */
/** moderation.action.recordedのresolveイベントをpublishする共通ヘルパー(#350)。 */
async function publishResolve(
  deps: GuildMemberAddDeps,
  params: {
    guildId: string;
    caseId: string;
    targetUserId: string;
    actionType: ModerationActionType;
    timeoutMinutes?: number;
    incident: RaidHitResult["incident"];
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

/** raid一括timeoutの実行結果をmoderation.action.recordedのresolveイベントとしてpublishする(#350)。 */
async function executeAndRecordRaidKick(
  deps: GuildMemberAddDeps,
  target: GuildMember,
  raidHit: RaidHitResult,
): Promise<void> {
  const execResult = await executeRaidKick(target, raidHit);
  await publishResolve(
    deps,
    {
      guildId: target.guild.id,
      caseId: raidHit.caseId,
      targetUserId: target.id,
      actionType: "kick",
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

  const lockdownSettings = await getLockdownSettings(deps.db, member.guild.id);
  if (lockdownSettings.isLocked) {
    await member.kick("moderation: lockdown active");
    await sendRaidKickDm(member);
    return;
  }

  const result = await handleGuildMemberAdd(deps, {
    guildId: member.guild.id,
    userId: member.id,
    roleIds: [...member.roles.cache.keys()],
    accountCreatedAt: member.user.createdAt,
    joinedAt: member.joinedAt ?? new Date(),
  });

  const raidHit = result.raidHit;
  if (raidHit && lockdownSettings.autoLockdownOnRaid) {
    await setLockdownRequested(deps.db, member.guild.id, true);
    await synchronizeLockdown(deps.db, member.guild);
  }
  const selfIsRaidTarget = raidHit !== null && raidHit.targetUserIds.includes(member.id);

  if (selfIsRaidTarget) {
    await executeAndRecordRaidKick(deps, member, raidHit);
  }

  if (raidHit) {
    const otherTargetIds = selfIsRaidTarget
      ? raidHit.targetUserIds.filter((id) => id !== member.id)
      : raidHit.targetUserIds;
    for (const targetUserId of otherTargetIds) {
      try {
        const target = await member.guild.members.fetch(targetUserId);
        await executeAndRecordRaidKick(deps, target, raidHit);
      } catch (error) {
        console.error(`moderation: failed to fetch raid target ${targetUserId} for case ${raidHit.caseId}`, error);
        await publishResolve(
          deps,
          {
            guildId: member.guild.id,
            caseId: raidHit.caseId,
            targetUserId,
            actionType: "kick",
            incident: raidHit.incident,
          },
          { result: "failed", failureCode: "member_not_found" },
        );
      }
    }
  }
}
