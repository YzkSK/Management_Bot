import type { GuildMember } from "discord.js";
import type { ModerationActionType } from "@management-bot/shared";
import {
  type EscalationResult,
  type GuildMemberAddDeps,
  handleGuildMemberAdd,
  type RaidHitResult,
} from "../application/index.js";

/** 自動検知によるアクションであることを表すreason(execute-action.tsのSYSTEM_MODERATOR_IDと対になる文言)。 */
function raidTimeoutReason(caseId: string, incidentCount: number): string {
  return `moderation: raid detected (incident #${incidentCount}, case ${caseId})`;
}

function newAccountGuardReason(outcome: EscalationResult): string {
  return `moderation: new_account_guard total strike ${outcome.strikeCount} (case ${outcome.caseId})`;
}

/**
 * actionTypeの重さ(execute-action.tsのACTION_SEVERITYと同じ考え方)。raid一括timeoutと
 * new_account_guardの処罰が同一入室者に重複適用される場合、より重い方だけを実行するために使う
 * (Codexレビュー指摘: 順に実行すると後勝ちでtimeoutが上書きされ、reasonがnew_account_guard側
 * だけになったりraidの長時間timeoutがnew_account_guardの短時間timeoutで上書きされたりする)。
 */
const ACTION_SEVERITY: Record<ModerationActionType, number> = {
  warn: 0,
  timeout: 1,
  kick: 2,
  ban: 3,
  unban: -1,
};

/**
 * レイドヒット時、対象ユーザー全員に一括timeoutを実行する。Discord APIレート制限に
 * 触れやすいため、初期実装は逐次実行から始める(設計spec「リスク・注意点」節、
 * 問題化したらキュー化・バックオフを検討)。個々のtimeout失敗(対象が既に退出した等)は
 * 他の対象への実行を止めないようログのみ行う。
 */
async function executeRaidTimeout(target: GuildMember, raidHit: RaidHitResult): Promise<void> {
  const reason = raidTimeoutReason(raidHit.caseId, raidHit.incidentCount);
  try {
    await target.timeout(raidHit.timeoutMinutes * 60 * 1000, reason);
  } catch (error) {
    console.error(`moderation: failed to timeout raid target ${target.id} for case ${raidHit.caseId}`, error);
  }
}

/**
 * new_account_guardヒット時、escalateAndRecordStrikeが決定したactionType(warn/timeout、
 * 設計spec「検知時アクション」節)を実行する。既存エスカレーション段階がkick/ban/unbanまで
 * 進んだ場合も同じ仕組みで実行する(#173の共通エスカレーション処理に接続しているため、
 * strikeが積み重なれば通常のエスカレーションと同様に段階が進みうる)。
 */
async function executeNewAccountGuardAction(member: GuildMember, outcome: EscalationResult): Promise<void> {
  const reason = newAccountGuardReason(outcome);
  try {
    switch (outcome.actionType) {
      case "warn":
        return;
      case "timeout": {
        const timeoutMinutes = outcome.timeoutMinutes ?? 10;
        await member.timeout(timeoutMinutes * 60 * 1000, reason);
        return;
      }
      case "kick":
        await member.kick(reason);
        return;
      case "ban":
        await member.ban({ reason });
        return;
      case "unban":
        return;
    }
  } catch (error) {
    console.error(`moderation: failed to execute new_account_guard action "${outcome.actionType}" for case ${outcome.caseId}`, error);
  }
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
    if (ACTION_SEVERITY.timeout >= ACTION_SEVERITY[guardOutcome.actionType]) {
      await executeRaidTimeout(member, raidHit);
    } else {
      await executeNewAccountGuardAction(member, guardOutcome);
    }
  } else if (guardOutcome) {
    await executeNewAccountGuardAction(member, guardOutcome);
  } else if (selfIsRaidTarget) {
    await executeRaidTimeout(member, raidHit);
  }

  if (raidHit) {
    const otherTargetIds = selfIsRaidTarget
      ? raidHit.targetUserIds.filter((id) => id !== member.id)
      : raidHit.targetUserIds;
    for (const targetUserId of otherTargetIds) {
      try {
        const target = await member.guild.members.fetch(targetUserId);
        await executeRaidTimeout(target, raidHit);
      } catch (error) {
        console.error(`moderation: failed to fetch raid target ${targetUserId} for case ${raidHit.caseId}`, error);
      }
    }
  }
}
