import type { GuildMember } from "discord.js";
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
 * レイドヒット時、対象ユーザー全員に一括timeoutを実行する。Discord APIレート制限に
 * 触れやすいため、初期実装は逐次実行から始める(設計spec「リスク・注意点」節、
 * 問題化したらキュー化・バックオフを検討)。個々のtimeout失敗(対象が既に退出した等)は
 * 他の対象への実行を止めないようログのみ行う。
 */
async function executeRaidTimeouts(guild: GuildMember["guild"], raidHit: RaidHitResult): Promise<void> {
  const reason = raidTimeoutReason(raidHit.caseId, raidHit.incidentCount);
  for (const targetUserId of raidHit.targetUserIds) {
    try {
      const target = await guild.members.fetch(targetUserId);
      await target.timeout(raidHit.timeoutMinutes * 60 * 1000, reason);
    } catch (error) {
      console.error(`moderation: failed to timeout raid target ${targetUserId} for case ${raidHit.caseId}`, error);
    }
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

  if (result.raidHit) {
    await executeRaidTimeouts(member.guild, result.raidHit);
  }

  if (result.newAccountGuardOutcome) {
    await executeNewAccountGuardAction(member, result.newAccountGuardOutcome);
  }
}
