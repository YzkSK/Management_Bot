import type { FeatureModuleContext } from "@management-bot/core";
import type { GuildBan, GuildMember, PartialGuildMember } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import type { GetChannelId, WriteLogEntryDeps } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";
import { writeLogEntrySafely } from "../write-log-entry-safely.js";

export function toMemberJoinLogEntry(member: GuildMember): LogEntry {
  return {
    category: "member",
    guildId: member.guild.id,
    createdAt: new Date().toISOString(),
    userId: member.id,
    userName: member.displayName,
    action: "join",
    actorIsBot: member.user.bot,
  };
}

/**
 * kick(自発退出ではなくBAN以外の強制退出)はguildMemberRemove単体では判別できない
 * (Discordのゲートウェイはkickもleaveも同じイベントで通知する)。ここでは常にleaveとして記録し、
 * kickの判別は#52の監査ログ相関(MemberKick)に委ねる。
 */
export function toMemberLeaveLogEntry(member: GuildMember | PartialGuildMember): LogEntry {
  return {
    category: "member",
    guildId: member.guild.id,
    createdAt: new Date().toISOString(),
    userId: member.id,
    userName: member.displayName,
    action: "leave",
    actorIsBot: member.user.bot,
  };
}

/**
 * ban/unbanのuserIdはBAN対象(実行者ではない)。actorIsBotは「イベントの実行者」を表すため、
 * ここでは対象アカウントのbot判定を誤って実行者として扱わないよう設定しない(codexレビュー指摘)。
 * 実行者の特定は#52の監査ログ相関に委ねる。
 */
export function toMemberBanLogEntry(ban: GuildBan): LogEntry {
  return {
    category: "member",
    guildId: ban.guild.id,
    createdAt: new Date().toISOString(),
    userId: ban.user.id,
    // BAN対象はguildMemberではなくUserしか取得できない(脱退済み扱いのため)ため、ニックネームは反映されない。
    userName: ban.user.displayName,
    action: "ban",
  };
}

export function toMemberUnbanLogEntry(ban: GuildBan): LogEntry {
  return {
    category: "member",
    guildId: ban.guild.id,
    createdAt: new Date().toISOString(),
    userId: ban.user.id,
    userName: ban.user.displayName,
    action: "unban",
  };
}

/**
 * 1回のguildMemberUpdateでニックネーム変更とタイムアウト付与/解除が同時に起こり得るため、複数エントリを返す。
 * 期限切れによる自動解除と手動解除はdiscord.jsのイベントだけでは区別できないため、どちらもtimeoutRemoveとして
 * 一律記録する(#81)。区別が必要な場合は#52の監査ログ相関(実行者の有無)に委ねる。
 * userIdは変更対象(実行者ではない)のため、ban/unban同様actorIsBotは設定しない(codexレビュー指摘)。
 * oldMemberがpartial(nickname/communicationDisabledUntilTimestamp未取得)の場合、実際は変化していなくても
 * 比較が常に不一致になり誤ったログを生成するため、比較前にスキップする。
 */
export function toMemberUpdateLogEntries(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember): LogEntry[] {
  if (oldMember.partial) return [];

  const createdAt = new Date().toISOString();
  const entries: LogEntry[] = [];

  if (oldMember.nickname !== newMember.nickname) {
    entries.push({
      category: "member",
      guildId: newMember.guild.id,
      createdAt,
      userId: newMember.id,
      userName: newMember.displayName,
      action: "nicknameChange",
      changes: {
        nickname: {
          before: oldMember.nickname,
          after: newMember.nickname,
        },
      },
    });
  }

  if (oldMember.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp) {
    if (newMember.communicationDisabledUntilTimestamp !== null) {
      entries.push({
        category: "member",
        guildId: newMember.guild.id,
        createdAt,
        userId: newMember.id,
        userName: newMember.displayName,
        action: "timeout",
      });
    } else {
      entries.push({
        category: "member",
        guildId: newMember.guild.id,
        createdAt,
        userId: newMember.id,
        userName: newMember.displayName,
        action: "timeoutRemove",
      });
    }
  }

  return entries;
}

export function registerMemberHandlers(ctx: FeatureModuleContext, getChannelId: GetChannelId): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx), getChannelId };

  ctx.client.on("guildMemberAdd", (member) => writeLogEntrySafely(deps, toMemberJoinLogEntry(member)));
  ctx.client.on("guildMemberRemove", (member) => writeLogEntrySafely(deps, toMemberLeaveLogEntry(member)));
  ctx.client.on("guildBanAdd", (ban) => writeLogEntrySafely(deps, toMemberBanLogEntry(ban)));
  ctx.client.on("guildBanRemove", (ban) => writeLogEntrySafely(deps, toMemberUnbanLogEntry(ban)));
  ctx.client.on("guildMemberUpdate", (oldMember, newMember) => {
    for (const entry of toMemberUpdateLogEntries(oldMember, newMember)) {
      writeLogEntrySafely(deps, entry);
    }
  });
}
