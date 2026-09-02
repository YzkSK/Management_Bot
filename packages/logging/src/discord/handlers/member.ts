import type { FeatureModuleContext } from "@management-bot/core";
import type { GuildBan, GuildMember, PartialGuildMember } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import type { WriteLogEntryDeps } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";
import { writeLogEntrySafely } from "../write-log-entry-safely.js";

export function toMemberJoinLogEntry(member: GuildMember): LogEntry {
  return {
    category: "member",
    guildId: member.guild.id,
    createdAt: new Date().toISOString(),
    userId: member.id,
    action: "join",
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
    action: "leave",
  };
}

export function toMemberBanLogEntry(ban: GuildBan): LogEntry {
  return {
    category: "member",
    guildId: ban.guild.id,
    createdAt: new Date().toISOString(),
    userId: ban.user.id,
    action: "ban",
  };
}

export function toMemberUnbanLogEntry(ban: GuildBan): LogEntry {
  return {
    category: "member",
    guildId: ban.guild.id,
    createdAt: new Date().toISOString(),
    userId: ban.user.id,
    action: "unban",
  };
}

/**
 * 1回のguildMemberUpdateでニックネーム変更とタイムアウト付与が同時に起こり得るため、複数エントリを返す。
 * タイムアウト解除(nullに戻る/期限切れ)はschema上表現するaction値がないため記録しない。
 */
export function toMemberUpdateLogEntries(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember): LogEntry[] {
  const createdAt = new Date().toISOString();
  const entries: LogEntry[] = [];

  if (oldMember.nickname !== newMember.nickname) {
    entries.push({ category: "member", guildId: newMember.guild.id, createdAt, userId: newMember.id, action: "nicknameChange" });
  }

  if (
    newMember.communicationDisabledUntilTimestamp !== null &&
    oldMember.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp
  ) {
    entries.push({ category: "member", guildId: newMember.guild.id, createdAt, userId: newMember.id, action: "timeout" });
  }

  return entries;
}

export function registerMemberHandlers(ctx: FeatureModuleContext): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx) };

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
